import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EnrichmentEngine,
  EnrichmentError,
  type EnrichmentData,
  type EnrichmentSource,
  type EnrichmentStore,
  type EnrichmentTrigger,
} from '../enrichment-engine.js';
import type { SemanticEntity } from '@iris/connector-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'contact:001',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@acme.com', company: 'Acme Corp' },
    relationships: [],
    lastModified: new Date().toISOString(),
    sourceId: 'hubspot:contact:001',
    ...overrides,
  };
}

function makeEnrichmentData(source: string): EnrichmentData {
  const now = new Date();
  return {
    source,
    data: { industry: 'SaaS', employeeCount: 200 },
    confidenceScore: 0.9,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + 86400_000),
  };
}

function makeSource(sourceId: string, returnData?: EnrichmentData | null): EnrichmentSource {
  const resolved = returnData === undefined ? makeEnrichmentData(sourceId) : returnData;
  return {
    sourceId,
    name: `Mock Source ${sourceId}`,
    fetchEnrichmentData: vi.fn().mockResolvedValue(resolved),
  };
}

function makeStore(): EnrichmentStore {
  const store = new Map<string, EnrichmentData>();
  return {
    get: vi.fn(async (entityId, sourceId) => store.get(`${entityId}:${sourceId}`) ?? null),
    set: vi.fn(async (entityId, data) => { store.set(`${entityId}:${data.source}`, data); }),
    getAll: vi.fn(async (entityId) =>
      [...store.entries()]
        .filter(([k]) => k.startsWith(`${entityId}:`))
        .map(([, v]) => v),
    ),
    isStale: vi.fn(async () => false),
    markRefreshTriggered: vi.fn(async () => undefined),
  };
}

function makeEngine(
  sources: EnrichmentSource[],
  triggers: EnrichmentTrigger[],
  store: EnrichmentStore,
) {
  return new EnrichmentEngine({ sources, triggers, store });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnrichmentEngine', () => {
  describe('enrichEntity', () => {
    it('returns empty map when no trigger matches entity type', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'company', sourceIds: ['company-enricher'] }],
        store,
      );

      const result = await engine.enrichEntity(makeEntity({ type: 'deal' }));
      expect(result.size).toBe(0);
      expect(source.fetchEnrichmentData).not.toHaveBeenCalled();
    });

    it('enriches entity with matching source and persists result', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const entity = makeEntity();
      const results = await engine.enrichEntity(entity);

      expect(results.size).toBe(1);
      const res = results.get('company-enricher')!;
      expect(res.isOk()).toBe(true);
      expect(store.set).toHaveBeenCalledOnce();
    });

    it('returns cached result without calling source again', async () => {
      const data = makeEnrichmentData('company-enricher');
      const source = makeSource('company-enricher', data);
      const store = makeStore();
      // Pre-populate cache
      vi.mocked(store.get).mockResolvedValue(data);

      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity());
      expect(source.fetchEnrichmentData).not.toHaveBeenCalled();
      const res = results.get('company-enricher')!;
      expect(res.isOk()).toBe(true);
    });

    it('returns err result when source throws', async () => {
      const source = makeSource('company-enricher');
      vi.mocked(source.fetchEnrichmentData).mockRejectedValue(new Error('API down'));
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity());
      const res = results.get('company-enricher')!;
      expect(res.isErr()).toBe(true);
      if (res.isErr()) {
        expect(res.error).toBeInstanceOf(EnrichmentError);
        expect(res.error.retryable).toBe(true);
        expect(res.error.sourceId).toBe('company-enricher');
      }
    });

    it('returns err result when source returns null (no data)', async () => {
      const source = makeSource('sentiment-enricher', null);
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['sentiment-enricher'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity());
      const res = results.get('sentiment-enricher')!;
      expect(res.isErr()).toBe(true);
      if (res.isErr()) {
        expect(res.error.retryable).toBe(false);
      }
    });

    it('handles multiple sources and collects all results', async () => {
      const s1 = makeSource('company-enricher');
      const s2 = makeSource('person-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [s1, s2],
        [{ entityType: 'contact', sourceIds: ['company-enricher', 'person-enricher'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity());
      expect(results.size).toBe(2);
      expect(results.get('company-enricher')!.isOk()).toBe(true);
      expect(results.get('person-enricher')!.isOk()).toBe(true);
    });

    it('applies wildcard trigger to all entity types', async () => {
      const source = makeSource('sentiment-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: '*', sourceIds: ['sentiment-enricher'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity({ type: 'deal' }));
      expect(results.size).toBe(1);
    });

    it('skips source if sourceId not registered', async () => {
      const store = makeStore();
      const engine = makeEngine(
        [],
        [{ entityType: 'contact', sourceIds: ['missing-source'] }],
        store,
      );

      const results = await engine.enrichEntity(makeEntity());
      expect(results.size).toBe(0);
    });
  });

  describe('enrichBatch', () => {
    it('enriches all matching entities in batch', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const entities = [
        makeEntity({ id: 'c:1' }),
        makeEntity({ id: 'c:2', type: 'deal' }),
        makeEntity({ id: 'c:3' }),
      ];

      const allResults = await engine.enrichBatch(entities);
      // 'deal' has no trigger, so only 2 entities appear
      expect(allResults.size).toBe(2);
    });

    it('returns empty map when no entities match triggers', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      const engine = makeEngine(
        [source],
        [{ entityType: 'company', sourceIds: ['company-enricher'] }],
        store,
      );

      const results = await engine.enrichBatch([makeEntity({ type: 'deal' })]);
      expect(results.size).toBe(0);
    });
  });

  describe('refreshEnrichment', () => {
    it('marks stale sources and re-fetches', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      vi.mocked(store.isStale).mockResolvedValue(true);

      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const result = await engine.refreshEnrichment('c:1', { email: 'a@b.com' }, 'contact');
      expect(result.isOk()).toBe(true);
      expect(store.markRefreshTriggered).toHaveBeenCalledWith('c:1', 'company-enricher');
      expect(source.fetchEnrichmentData).toHaveBeenCalledOnce();
    });

    it('returns ok immediately when nothing is stale', async () => {
      const source = makeSource('company-enricher');
      const store = makeStore();
      vi.mocked(store.isStale).mockResolvedValue(false);

      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const result = await engine.refreshEnrichment('c:1', {}, 'contact');
      expect(result.isOk()).toBe(true);
      expect(source.fetchEnrichmentData).not.toHaveBeenCalled();
    });

    it('returns err when refresh fetch throws', async () => {
      const source = makeSource('company-enricher');
      vi.mocked(source.fetchEnrichmentData).mockRejectedValue(new Error('timeout'));
      const store = makeStore();
      vi.mocked(store.isStale).mockResolvedValue(true);

      const engine = makeEngine(
        [source],
        [{ entityType: 'contact', sourceIds: ['company-enricher'] }],
        store,
      );

      const result = await engine.refreshEnrichment('c:1', {}, 'contact');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getEnrichments', () => {
    it('delegates to store.getAll', async () => {
      const store = makeStore();
      const data = makeEnrichmentData('company-enricher');
      vi.mocked(store.getAll).mockResolvedValue([data]);

      const engine = makeEngine([], [], store);
      const enrichments = await engine.getEnrichments('c:1');
      expect(enrichments).toHaveLength(1);
      expect(store.getAll).toHaveBeenCalledWith('c:1');
    });
  });

  describe('registerSource', () => {
    it('adds a new source that is then applied by triggers', async () => {
      const store = makeStore();
      const engine = makeEngine(
        [],
        [{ entityType: 'contact', sourceIds: ['dynamic-source'] }],
        store,
      );

      // Before registration — no results
      let results = await engine.enrichEntity(makeEntity());
      expect(results.size).toBe(0);

      // After registration — source is applied
      engine.registerSource(makeSource('dynamic-source'));
      results = await engine.enrichEntity(makeEntity());
      expect(results.size).toBe(1);
    });
  });
});
