import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConnectorTestHarness,
  makeSyncOptions,
  makeEntity,
} from '../connector-test-harness.js';
import type { SemanticEntity } from '../../base-connector.js';

function makeSyncGenerator(entities: SemanticEntity[]): AsyncGenerator<SemanticEntity> {
  return (async function* () {
    for (const e of entities) yield e;
  })();
}

describe('ConnectorTestHarness', () => {
  let harness: ConnectorTestHarness;

  beforeEach(() => {
    harness = new ConnectorTestHarness({
      connectorId: 'test',
      apiBaseUrl: 'https://api.test.example.com',
    });
  });

  afterEach(() => {
    harness.reset();
  });

  describe('mockConnectorAPI', () => {
    it('sets up fetch mock for registered paths', async () => {
      harness.mockConnectorAPI([
        { path: '/contacts', method: 'GET', body: { results: [] } },
      ]);

      const res = await fetch('https://api.test.example.com/contacts');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.results).toEqual([]);
    });

    it('returns 404 for unregistered paths', async () => {
      harness.mockConnectorAPI([]);
      const res = await fetch('https://api.test.example.com/unknown');
      expect(res.status).toBe(404);
    });

    it('respects custom status codes', async () => {
      harness.mockConnectorAPI([
        { path: '/auth', status: 401, body: { error: 'unauthorized' } },
      ]);
      const res = await fetch('https://api.test.example.com/auth');
      expect(res.status).toBe(401);
    });
  });

  describe('collectSyncOutput', () => {
    it('collects all entities from generator', async () => {
      const entities = [makeEntity({ id: 'test:contact:1' }), makeEntity({ id: 'test:contact:2' })];
      const gen = makeSyncGenerator(entities);
      const result = await harness.collectSyncOutput(gen);
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('test:contact:1');
    });

    it('returns empty array for empty generator', async () => {
      const result = await harness.collectSyncOutput(makeSyncGenerator([]));
      expect(result).toHaveLength(0);
    });
  });

  describe('assertSyncOutput', () => {
    it('passes when entity count matches', () => {
      const entities = [makeEntity(), makeEntity({ id: 'test:contact:2' })];
      expect(() =>
        harness.assertSyncOutput(entities, { expectedCount: 2 }),
      ).not.toThrow();
    });

    it('throws when entity count does not match', () => {
      expect(() =>
        harness.assertSyncOutput([makeEntity()], { expectedCount: 3 }),
      ).toThrow('Expected 3 entities');
    });

    it('passes when expected types are present', () => {
      const entities = [makeEntity({ type: 'contact' }), makeEntity({ id: 'test:deal:1', type: 'deal' })];
      expect(() =>
        harness.assertSyncOutput(entities, { expectedTypes: ['contact', 'deal'] }),
      ).not.toThrow();
    });

    it('throws when expected type is missing', () => {
      const entities = [makeEntity({ type: 'contact' })];
      expect(() =>
        harness.assertSyncOutput(entities, { expectedTypes: ['deal'] }),
      ).toThrow('Expected entity type "deal"');
    });

    it('validates shapes by default', () => {
      const bad = [{ id: 'bad', type: '', label: '' }] as unknown as SemanticEntity[];
      expect(() => harness.assertSyncOutput(bad)).toThrow();
    });
  });

  describe('assertEntityShape', () => {
    it('passes for a valid entity', () => {
      expect(() => harness.assertEntityShape(makeEntity())).not.toThrow();
    });

    it('throws for an entity with malformed id', () => {
      const bad = makeEntity({ id: 'nocolon' });
      expect(() => harness.assertEntityShape(bad)).toThrow('namespaced');
    });

    it('throws for a non-object', () => {
      expect(() => harness.assertEntityShape(null)).toThrow('Expected SemanticEntity object');
    });

    it('throws for missing label', () => {
      const bad = makeEntity({ label: '' });
      expect(() => harness.assertEntityShape(bad)).toThrow('label');
    });
  });

  describe('assertWithinLatency', () => {
    it('passes when operation completes within SLA', async () => {
      const result = await harness.assertWithinLatency(
        async () => 42,
        { maxMs: 1000 },
      );
      expect(result).toBe(42);
    });

    it('throws when operation exceeds SLA', async () => {
      await expect(
        harness.assertWithinLatency(
          async () => {
            await new Promise((r) => setTimeout(r, 50));
          },
          { maxMs: 1 },
        ),
      ).rejects.toThrow('latency SLA');
    });
  });

  describe('assertManifest', () => {
    const validManifest = {
      id: 'hubspot',
      name: 'HubSpot',
      description: 'HubSpot CRM',
      icon: 'hubspot.svg',
      auth: { type: 'oauth2' as const, scopes: ['contacts'] },
      entityTypes: ['contact', 'deal'],
      configSchema: { parse: vi.fn() } as never,
      rateLimits: { requestsPerSecond: 10 },
    };

    it('passes for a valid manifest', () => {
      expect(() => harness.assertManifest(validManifest)).not.toThrow();
    });

    it('throws when id is missing', () => {
      expect(() => harness.assertManifest({ ...validManifest, id: '' })).toThrow('id and name');
    });

    it('throws when entityTypes is empty', () => {
      expect(() => harness.assertManifest({ ...validManifest, entityTypes: [] })).toThrow('entityType');
    });

    it('throws when configSchema is missing', () => {
      const { configSchema, ...rest } = validManifest;
      void configSchema;
      expect(() => harness.assertManifest(rest as never)).toThrow('configSchema');
    });
  });

  describe('assertSchema', () => {
    it('passes when all expected types are present', () => {
      const schema = {
        entityTypes: [{ name: 'contact', attributes: [] }, { name: 'deal', attributes: [] }],
        version: '1.0.0',
      };
      expect(() => harness.assertSchema(schema, ['contact', 'deal'])).not.toThrow();
    });

    it('throws when a type is missing', () => {
      const schema = { entityTypes: [{ name: 'contact', attributes: [] }], version: '1.0.0' };
      expect(() => harness.assertSchema(schema, ['contact', 'company'])).toThrow('company');
    });
  });

  describe('assertHealthStatus', () => {
    it('passes for a valid status', () => {
      expect(() =>
        harness.assertHealthStatus({ healthy: true, checkedAt: new Date() }),
      ).not.toThrow();
    });

    it('throws when checkedAt is not a Date', () => {
      expect(() =>
        harness.assertHealthStatus({ healthy: true, checkedAt: '2026-01-01' as unknown as Date }),
      ).toThrow('Date');
    });
  });
});

describe('makeSyncOptions', () => {
  it('returns defaults', () => {
    const opts = makeSyncOptions();
    expect(opts.limit).toBe(50);
    expect(opts.entityTypes).toEqual([]);
  });

  it('applies overrides', () => {
    const opts = makeSyncOptions({ limit: 200, cursor: 'abc' });
    expect(opts.limit).toBe(200);
    expect(opts.cursor).toBe('abc');
  });
});

describe('makeEntity', () => {
  it('creates a valid entity', () => {
    const e = makeEntity();
    expect(e.id).toBe('test:contact:1');
    expect(e.type).toBe('contact');
    expect(Array.isArray(e.relationships)).toBe(true);
    expect(e.lastModified instanceof Date).toBe(true);
  });

  it('applies overrides', () => {
    const e = makeEntity({ id: 'hubspot:deal:99', type: 'deal', label: 'Big Deal' });
    expect(e.id).toBe('hubspot:deal:99');
    expect(e.type).toBe('deal');
    expect(e.label).toBe('Big Deal');
  });
});
