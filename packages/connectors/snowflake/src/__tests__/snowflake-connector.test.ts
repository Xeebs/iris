import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SnowflakeConnector } from '../snowflake-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import tablesFixture from '../../tests/fixtures/tables.json' assert { type: 'json' };

const ACCOUNT = 'test-account';
const BASE_URL = `https://${ACCOUNT}.snowflakecomputing.com`;

const VALID_CONFIG = {
  account: ACCOUNT,
  username: 'test-user',
  password: 'test-password',
  warehouse: 'COMPUTE_WH',
  database: 'ANALYTICS',
  schema: 'PUBLIC',
  tables: [
    {
      name: 'CUSTOMERS',
      entityType: 'customer',
      updatedAtColumn: 'UPDATED_AT',
      labelColumn: 'NAME',
    },
  ],
};

const server = setupServer(
  http.post(`${BASE_URL}/api/v2/statements`, () =>
    HttpResponse.json(tablesFixture),
  ),
  http.get(`${BASE_URL}/api/v2/statements/:handle`, () =>
    HttpResponse.json({ data: [] }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SnowflakeConnector', () => {
  describe('connect()', () => {
    it('succeeds with valid config and reachable Snowflake', async () => {
      const connector = new SnowflakeConnector();
      const result = await connector.connect(VALID_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    it('fails with invalid config — missing required fields', async () => {
      const connector = new SnowflakeConnector();
      const result = await connector.connect({ account: '' } as never);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('fails when Snowflake returns 401', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v2/statements`, () =>
          HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
        ),
      );
      const connector = new SnowflakeConnector();
      const result = await connector.connect(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('CONNECTION_FAILED');
    });

    it('marks connection error as retryable on 5xx', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v2/statements`, () =>
          HttpResponse.json({ message: 'Internal error' }, { status: 500 }),
        ),
      );
      const connector = new SnowflakeConnector();
      const result = await connector.connect(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().retryable).toBe(true);
    });
  });

  describe('sync()', () => {
    it('yields entities from the fixture', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities).toHaveLength(3);
    });

    it('all yielded entities pass shape validation', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      for await (const entity of connector.sync({})) {
        expect(() => assertEntityShape(entity)).not.toThrow();
      }
    });

    it('uses labelColumn for entity label', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities[0]?.label).toBe('Acme Corp');
      expect(entities[1]?.label).toBe('Globex Inc');
    });

    it('uses entityType from table config', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      for await (const entity of connector.sync({})) {
        expect(entity.type).toBe('customer');
      }
    });

    it('includes all columns as attributes', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      const first = entities[0];
      expect(first?.attributes['id']).toBe('cust-001');
      expect(first?.attributes['email']).toBe('contact@acme.com');
      expect(first?.attributes['status']).toBe('active');
      expect(first?.attributes['table']).toBe('CUSTOMERS');
    });

    it('includes updatedAt in lastModified', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities[0]?.lastModified).toBeInstanceOf(Date);
      expect(entities[0]?.lastModified.getFullYear()).toBe(2024);
    });

    it('filters tables by entityTypes when provided', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect({
        ...VALID_CONFIG,
        tables: [
          { name: 'CUSTOMERS', entityType: 'customer', updatedAtColumn: 'UPDATED_AT' },
          { name: 'ORDERS', entityType: 'order', updatedAtColumn: 'UPDATED_AT' },
        ],
      });

      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['customer'] })) {
        entities.push(entity);
      }

      expect(entities.every((e) => e.type === 'customer')).toBe(true);
    });

    it('throws when sync called before connect', async () => {
      const connector = new SnowflakeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* noop */ }
      }).rejects.toThrow();
    });

    it('fetches additional partitions when present', async () => {
      const multiPartitionFixture = {
        ...tablesFixture,
        resultSetMetaData: {
          ...tablesFixture.resultSetMetaData,
          partitionInfo: [{ rowCount: 3 }, { rowCount: 1 }],
        },
      };

      server.use(
        http.post(`${BASE_URL}/api/v2/statements`, () =>
          HttpResponse.json(multiPartitionFixture),
        ),
        http.get(`${BASE_URL}/api/v2/statements/:handle`, () =>
          HttpResponse.json({
            data: [['cust-004', 'Umbrella Corp', 'info@umbrella.com', 'active', '2024-03-21T12:00:00.000Z']],
          }),
        ),
      );

      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);

      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities).toHaveLength(4);
    });
  });

  describe('getSchema()', () => {
    it('returns entity types derived from configured tables', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);
      const schema = await connector.getSchema();

      expect(schema.entityTypes).toHaveLength(1);
      expect(schema.entityTypes[0]?.name).toBe('customer');
    });

    it('returns empty entityTypes before connect', async () => {
      const connector = new SnowflakeConnector();
      const schema = await connector.getSchema();
      expect(schema.entityTypes).toHaveLength(0);
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy when Snowflake responds', async () => {
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy on 5xx from Snowflake', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v2/statements`, () =>
          HttpResponse.json({ message: 'Internal error' }, { status: 500 }),
        ),
      );
      const connector = new SnowflakeConnector();
      await connector.connect(VALID_CONFIG);
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(false);
      expect(status.error).toBeDefined();
    });
  });
});
