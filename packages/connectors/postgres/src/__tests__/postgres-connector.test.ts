import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pgTypeToAttributeType, isIncrementalSync, describeQuery } from '../sql-query-builder.js';
import { rowToEntity } from '../transformers.js';

// ─── Mock the postgres module ─────────────────────────────────────────────────
// The postgres library uses tagged template literals for queries (sql`...`) and
// regular function calls for identifiers (sql(tableName)). We route only tagged
// template calls to mockSql so identifier calls don't consume the queue.

const mockSql = vi.fn();

vi.mock('postgres', () => {
  const createSql = () => {
    const fn = vi.fn();
    const proxy = new Proxy(fn, {
      get: (_target, prop: string | symbol) => {
        if (prop === 'end') return vi.fn().mockResolvedValue(undefined);
        return undefined;
      },
      apply: (_target, _thisArg, args: unknown[]) => {
        // Tagged template: first arg is a TemplateStringsArray (has own 'raw' property)
        if (
          Array.isArray(args[0]) &&
          Object.prototype.hasOwnProperty.call(args[0], 'raw')
        ) {
          return mockSql(...args);
        }
        // Regular identifier call sql(tableName) — return a string stub, don't consume queue
        return '__identifier__';
      },
    });
    return proxy;
  };
  return { default: () => createSql() };
});

import { PostgresConnector, manifest } from '../postgres-connector.js';

const VALID_CONFIG = {
  connectionString: 'postgres://user:pass@localhost:5432/testdb',
  tables: [
    {
      name: 'customers',
      entityType: 'customer',
      updatedAtColumn: 'updated_at',
      labelColumn: 'name',
    },
  ],
};

function makeCustomerRow(id = '1', name = 'Alice Corp') {
  return {
    id,
    name,
    email: 'alice@example.com',
    tier: 'enterprise',
    updated_at: new Date('2024-01-10'),
  };
}

describe('PostgresConnector', () => {
  let connector: PostgresConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue([{ '?column?': 1 }]);
    connector = new PostgresConnector();
  });

  describe('connect()', () => {
    it('succeeds with valid config', async () => {
      const result = await connector.connect(VALID_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    it('fails when connectionString is empty', async () => {
      const result = await connector.connect({ ...VALID_CONFIG, connectionString: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('fails when tables array is empty', async () => {
      const result = await connector.connect({ ...VALID_CONFIG, tables: [] });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('returns CONNECTION_FAILED (retryable) on DB connection error', async () => {
      mockSql.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await connector.connect(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      const e = result._unsafeUnwrapErr();
      expect(e.code).toBe('CONNECTION_FAILED');
      expect(e.retryable).toBe(true);
    });
  });

  describe('sync()', () => {
    it('throws NOT_CONNECTED when not connected', async () => {
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* empty */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });

    it('yields entities for table rows', async () => {
      await connector.connect(VALID_CONFIG);
      const rows = [makeCustomerRow('1', 'Alice'), makeCustomerRow('2', 'Bob')];
      // connect() already consumed one mockSql call (SELECT 1).
      // First sync page returns rows, second returns empty.
      mockSql
        .mockResolvedValueOnce(rows)
        .mockResolvedValue([]);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities).toHaveLength(2);
      expect(entities[0]?.id).toBe('postgres:customer:1');
      expect(entities[0]?.type).toBe('customer');
      expect(entities[0]?.label).toBe('Alice');
      expect(entities[0]?.attributes['email']).toBe('alice@example.com');
    });

    it('maps entity ID and sourceId correctly', async () => {
      await connector.connect(VALID_CONFIG);
      mockSql
        .mockResolvedValueOnce([{ id: '42', name: 'Acme', updated_at: new Date() }])
        .mockResolvedValue([]);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }
      expect(entities[0]?.id).toBe('postgres:customer:42');
      expect(entities[0]?.sourceId).toBe('postgres:customers:42');
    });

    it('respects entityTypes filter in SyncOptions', async () => {
      const config = {
        ...VALID_CONFIG,
        tables: [
          { name: 'customers', entityType: 'customer' },
          { name: 'orders', entityType: 'order' },
        ],
      };
      await connector.connect(config);
      mockSql
        .mockResolvedValueOnce([makeCustomerRow()])
        .mockResolvedValue([]);

      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['customer'] })) {
        entities.push(entity);
      }
      expect(entities.length).toBeGreaterThan(0);
      expect(entities.every((e) => e.type === 'customer')).toBe(true);
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when connected and SELECT 1 succeeds', async () => {
      await connector.connect(VALID_CONFIG);
      mockSql.mockResolvedValueOnce([{ '?column?': 1 }]);
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toBe('Not connected');
    });
  });

  describe('manifest', () => {
    it('has correct id', () => {
      expect(manifest.id).toBe('postgres');
    });

    it('has configSchema requiring connectionString and tables', () => {
      const parsed = manifest.configSchema.safeParse({
        connectionString: 'postgres://localhost/db',
        tables: [{ name: 'users', entityType: 'user' }],
      });
      expect(parsed.success).toBe(true);
    });
  });
});

// ─── sql-query-builder unit tests ────────────────────────────────────────────

describe('pgTypeToAttributeType', () => {
  it('maps integer to number', () => {
    expect(pgTypeToAttributeType('integer')).toBe('number');
    expect(pgTypeToAttributeType('bigint')).toBe('number');
    expect(pgTypeToAttributeType('numeric')).toBe('number');
  });

  it('maps boolean to boolean', () => {
    expect(pgTypeToAttributeType('boolean')).toBe('boolean');
  });

  it('maps timestamp to date', () => {
    expect(pgTypeToAttributeType('timestamp')).toBe('date');
    expect(pgTypeToAttributeType('timestamptz')).toBe('date');
    expect(pgTypeToAttributeType('date')).toBe('date');
  });

  it('maps text/varchar to string', () => {
    expect(pgTypeToAttributeType('text')).toBe('string');
    expect(pgTypeToAttributeType('character varying')).toBe('string');
    expect(pgTypeToAttributeType('uuid')).toBe('string');
  });
});

describe('isIncrementalSync', () => {
  it('returns true when updatedAtColumn and lastSyncedAt are both set', () => {
    expect(isIncrementalSync({ updatedAtColumn: 'updated_at' }, new Date())).toBe(true);
  });

  it('returns false when updatedAtColumn is missing', () => {
    expect(isIncrementalSync({ updatedAtColumn: undefined }, new Date())).toBe(false);
  });

  it('returns false when lastSyncedAt is missing', () => {
    expect(isIncrementalSync({ updatedAtColumn: 'updated_at' }, undefined)).toBe(false);
  });
});

describe('describeQuery', () => {
  it('includes table name and limit', () => {
    const desc = describeQuery({
      tableName: 'orders',
      updatedAtColumn: undefined,
      sinceDate: null,
      batchSize: 500,
      offset: 0,
    });
    expect(desc).toContain('orders');
    expect(desc).toContain('LIMIT 500');
  });

  it('includes WHERE clause for incremental sync', () => {
    const sinceDate = new Date('2024-01-01T00:00:00Z');
    const desc = describeQuery({
      tableName: 'orders',
      updatedAtColumn: 'updated_at',
      sinceDate,
      batchSize: 500,
      offset: 0,
    });
    expect(desc).toContain('WHERE updated_at');
    expect(desc).toContain('2024-01-01');
  });
});

// ─── transformers unit tests ─────────────────────────────────────────────────

describe('rowToEntity', () => {
  const tableConf = { name: 'customers', entityType: 'customer', updatedAtColumn: undefined as string | undefined, labelColumn: undefined as string | undefined };

  it('builds entity ID from row id field', () => {
    const entity = rowToEntity({ id: 'cust-1', name: 'Acme' }, tableConf);
    expect(entity.id).toBe('postgres:customer:cust-1');
    expect(entity.sourceId).toBe('postgres:customers:cust-1');
  });

  it('uses labelColumn for entity label when configured', () => {
    const entity = rowToEntity(
      { id: 'c-1', company_name: 'Acme Corp' },
      { ...tableConf, labelColumn: 'company_name' }
    );
    expect(entity.label).toBe('Acme Corp');
  });

  it('falls back to table:id label when no labelColumn', () => {
    const entity = rowToEntity({ id: 'c-1', name: 'Acme' }, tableConf);
    expect(entity.label).toBe('customers:c-1');
  });

  it('converts Date values to ISO strings in attributes', () => {
    const d = new Date('2024-01-15T10:00:00Z');
    const entity = rowToEntity({ id: 'r-1', created_at: d }, tableConf);
    expect(entity.attributes['created_at']).toBe(d.toISOString());
  });

  it('maps null column values to null attributes', () => {
    const entity = rowToEntity({ id: 'r-1', description: null }, tableConf);
    expect(entity.attributes['description']).toBeNull();
  });

  it('uses updatedAtColumn for lastModified', () => {
    const d = new Date('2024-06-08T00:00:00Z');
    const entity = rowToEntity(
      { id: 'r-1', updated_at: d },
      { ...tableConf, updatedAtColumn: 'updated_at' }
    );
    expect(entity.lastModified.getTime()).toBe(d.getTime());
  });
});
