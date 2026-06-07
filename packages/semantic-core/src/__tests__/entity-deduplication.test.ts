import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../embedding.js', () => ({
  generateEmbeddings: vi.fn(),
  buildEmbeddingInput: vi.fn((e: SemanticEntity) => `${e.type}: ${e.label}`),
}));

import { generateEmbeddings } from '../embedding.js';

import {
  nameSimilarity,
  emailDomainMatch,
  computeCompositeScore,
  EntityDuplicateMatcher,
} from '../entity-deduplication.js';

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'ent-001',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com', company: 'Acme' },
    relationships: [],
    lastModified: '2026-06-07T00:00:00Z',
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

const mockSqlFn = vi.fn().mockReturnValue(Promise.resolve([]));
const sql = new Proxy(mockSqlFn, {
  get: (_t, prop) => (prop === 'json' ? (v: unknown) => v : mockSqlFn),
  apply: (_t, _ctx, args) => mockSqlFn(...args),
}) as unknown as Parameters<typeof EntityDuplicateMatcher>[1];

const mockSearch = vi.fn();
const mockListByType = vi.fn();
const vectorStore = {
  search: mockSearch,
  listByType: mockListByType,
} as unknown as Parameters<typeof EntityDuplicateMatcher>[0];

describe('nameSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(nameSimilarity('Alice Smith', 'Alice Smith')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(nameSimilarity('abc', 'xyz')).toBeLessThan(0.5);
  });

  it('is case-insensitive', () => {
    expect(nameSimilarity('alice', 'ALICE')).toBe(1);
  });

  it('returns 0 for empty input', () => {
    expect(nameSimilarity('', 'Alice')).toBe(0);
    expect(nameSimilarity('Alice', '')).toBe(0);
  });

  it('returns high similarity for minor typo', () => {
    expect(nameSimilarity('Alice Smith', 'Alice Smyth')).toBeGreaterThan(0.8);
  });
});

describe('emailDomainMatch', () => {
  it('returns true when both entities share the same email domain', () => {
    const a = makeEntity({ attributes: { email: 'alice@example.com' } });
    const b = makeEntity({ attributes: { email: 'bob@example.com' } });
    expect(emailDomainMatch(a, b)).toBe(true);
  });

  it('returns false for different domains', () => {
    const a = makeEntity({ attributes: { email: 'alice@example.com' } });
    const b = makeEntity({ attributes: { email: 'bob@other.com' } });
    expect(emailDomainMatch(a, b)).toBe(false);
  });

  it('returns false when neither entity has an email', () => {
    const a = makeEntity({ attributes: { name: 'Alice' } });
    const b = makeEntity({ attributes: { name: 'Bob' } });
    expect(emailDomainMatch(a, b)).toBe(false);
  });

  it('returns false when only one entity has an email', () => {
    const a = makeEntity({ attributes: { email: 'alice@example.com' } });
    const b = makeEntity({ attributes: { name: 'Bob' } });
    expect(emailDomainMatch(a, b)).toBe(false);
  });
});

describe('computeCompositeScore', () => {
  it('returns 1 for perfect match on all signals', () => {
    expect(computeCompositeScore(1, true, 1)).toBeCloseTo(1.0);
  });

  it('returns 0 for zero match on all signals', () => {
    expect(computeCompositeScore(0, false, 0)).toBe(0);
  });

  it('weights name 40%, email domain 30%, embedding 30%', () => {
    const score = computeCompositeScore(1, false, 0);
    expect(score).toBeCloseTo(0.4);
  });
});

describe('EntityDuplicateMatcher', () => {
  let matcher: EntityDuplicateMatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    matcher = new EntityDuplicateMatcher(vectorStore, sql);
  });

  describe('analyze', () => {
    it('returns empty candidatePairs when no entities', async () => {
      mockListByType.mockResolvedValue([]);
      vi.mocked(generateEmbeddings).mockResolvedValue([]);

      const result = await matcher.analyze('ws-test', {});

      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.candidatePairs).toHaveLength(0);
      expect(report.scannedCount).toBe(0);
    });

    it('detects high confidence duplicate pair', async () => {
      const entityA = makeEntity({ id: 'ent-A', label: 'Alice Smith' });
      const entityB = makeEntity({
        id: 'ent-B',
        label: 'Alice Smyth',
        attributes: { email: 'alice@example.com' },
      });

      mockListByType.mockResolvedValue([entityA, entityB]);
      vi.mocked(generateEmbeddings).mockResolvedValue([
        { entityId: 'ent-A', vector: [1, 0, 0] },
        { entityId: 'ent-B', vector: [0.99, 0.1, 0] },
      ]);
      mockSearch
        .mockResolvedValueOnce([{ entity: entityB, score: 0.96 }])
        .mockResolvedValueOnce([{ entity: entityA, score: 0.96 }]);

      const result = await matcher.analyze('ws-test', { entityType: 'contact', threshold: 0.5 });

      expect(result.isOk()).toBe(true);
      const report = result._unsafeUnwrap();
      expect(report.candidatePairs.length).toBeGreaterThan(0);
      expect(report.candidatePairs[0]!.confidence).toBe('high');
    });

    it('filters pairs below threshold', async () => {
      const entityA = makeEntity({ id: 'ent-A' });
      const entityB = makeEntity({ id: 'ent-B', label: 'Completely Different Name', attributes: {} });

      mockListByType.mockResolvedValue([entityA, entityB]);
      vi.mocked(generateEmbeddings).mockResolvedValue([
        { entityId: 'ent-A', vector: [1, 0, 0] },
        { entityId: 'ent-B', vector: [0, 1, 0] },
      ]);
      mockSearch
        .mockResolvedValueOnce([{ entity: entityB, score: 0.1 }])
        .mockResolvedValueOnce([{ entity: entityA, score: 0.1 }]);

      const result = await matcher.analyze('ws-test', { entityType: 'contact', threshold: 0.60 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().candidatePairs).toHaveLength(0);
    });

    it('skips self-comparisons', async () => {
      const entity = makeEntity({ id: 'ent-A' });
      mockListByType.mockResolvedValue([entity]);
      vi.mocked(generateEmbeddings).mockResolvedValue([
        { entityId: 'ent-A', vector: [1, 0, 0] },
      ]);
      mockSearch.mockResolvedValueOnce([{ entity, score: 1.0 }]);

      const result = await matcher.analyze('ws-test', { entityType: 'contact' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().candidatePairs).toHaveLength(0);
    });

    it('returns error on vector store failure', async () => {
      mockListByType.mockRejectedValue(new Error('vector store down'));

      const result = await matcher.analyze('ws-test', {});

      expect(result.isErr()).toBe(true);
    });
  });

  describe('merge', () => {
    it('inserts canonical link and returns it', async () => {
      const link = {
        id: 'link-uuid',
        workspaceId: 'ws-test',
        canonicalEntityId: 'ent-A',
        duplicateEntityId: 'ent-B',
        similarityScore: 0.92,
        signals: { nameSimilarity: 0.9, emailDomainMatch: true, embeddingSimilarity: 0.94, compositeScore: 0.92 },
        mergedBy: 'admin',
        mergedAt: '2026-06-07T00:00:00Z',
        createdAt: '2026-06-07T00:00:00Z',
      };
      mockSqlFn.mockResolvedValueOnce([link]);

      const result = await matcher.merge(
        'ws-test', 'ent-A', 'ent-B',
        { nameSimilarity: 0.9, emailDomainMatch: true, embeddingSimilarity: 0.94, compositeScore: 0.92 },
        'admin',
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().canonicalEntityId).toBe('ent-A');
    });

    it('returns error when SQL throws', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('DB error'));

      const result = await matcher.merge(
        'ws-test', 'ent-A', 'ent-B',
        { nameSimilarity: 0.9, emailDomainMatch: false, embeddingSimilarity: 0.85, compositeScore: 0.61 },
        'admin',
      );

      expect(result.isErr()).toBe(true);
    });
  });

  describe('getSuppressedIds', () => {
    it('returns a set of duplicate entity IDs', async () => {
      mockSqlFn.mockResolvedValueOnce([
        { duplicateEntityId: 'ent-B' },
        { duplicateEntityId: 'ent-C' },
      ]);

      const ids = await matcher.getSuppressedIds('ws-test');

      expect(ids.has('ent-B')).toBe(true);
      expect(ids.has('ent-C')).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('returns empty set on SQL error', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('DB error'));

      const ids = await matcher.getSuppressedIds('ws-test');

      expect(ids.size).toBe(0);
    });
  });
});
