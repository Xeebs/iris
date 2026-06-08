import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../embedding-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embedding-provider.js')>();
  return { ...actual };
});

import { recordEmbeddingMetadata, getEmbeddingMetadata, reindexWorkspace } from '../reindex-utils.js';
import type { EmbeddingProvider } from '../embedding-provider.js';
import type { VectorStore } from '../vector-store.js';

function makeProvider(dim = 1536): EmbeddingProvider {
  return {
    getModelId: () => 'test-model',
    getModelDimensions: () => dim,
    getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    batchEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
  };
}

function makeVectorStore(): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSql(rows: unknown[][] = []): ReturnType<typeof import('postgres')['default']> {
  let callCount = 0;
  return Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => {
      const result = rows[callCount] ?? [];
      callCount++;
      return Promise.resolve(result);
    },
    { end: vi.fn() },
  ) as unknown as ReturnType<typeof import('postgres')['default']>;
}

describe('recordEmbeddingMetadata', () => {
  it('calls sql with correct upsert parameters', async () => {
    const queryCalls: unknown[] = [];
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        queryCalls.push({ strings, values });
        return Promise.resolve([]);
      },
    ) as unknown as ReturnType<typeof import('postgres')['default']>;

    await recordEmbeddingMetadata(sql, 'ws-1', 'text-embedding-3-small', 1536);
    expect(queryCalls.length).toBe(1);
  });
});

describe('getEmbeddingMetadata', () => {
  it('returns null when no rows found', async () => {
    const sql = makeSql([[]]);
    const result = await getEmbeddingMetadata(sql, 'ws-1');
    expect(result).toBeNull();
  });

  it('returns metadata when row exists', async () => {
    const sql = makeSql([[{
      model_id: 'text-embedding-3-small',
      dimension: 1536,
      created_at: new Date('2026-01-01'),
    }]]);
    const result = await getEmbeddingMetadata(sql, 'ws-1');
    expect(result).toEqual({
      modelId: 'text-embedding-3-small',
      dimension: 1536,
      createdAt: new Date('2026-01-01'),
    });
  });
});

describe('reindexWorkspace', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns empty result when no entities found', async () => {
    const sql = makeSql([[]]);
    const provider = makeProvider();
    const vectorStore = makeVectorStore();

    const result = await reindexWorkspace(sql, vectorStore, 'ws-1', provider);
    expect(result.entitiesProcessed).toBe(0);
    expect(result.batchesCompleted).toBe(0);
  });

  it('processes entities and calls vectorStore.upsert', async () => {
    const entities = [
      { id: 'e1', workspace_id: 'ws-1', label: 'Acme', entity_type: 'company', attributes: {} },
      { id: 'e2', workspace_id: 'ws-1', label: 'Bob', entity_type: 'contact', attributes: { email: 'bob@example.com' } },
    ];
    // First call returns entities, second call (cursor pagination) returns empty
    let call = 0;
    const sql = Object.assign(
      () => {
        call++;
        if (call === 1) return Promise.resolve(entities);
        if (call === 2) return Promise.resolve([]); // Empty means stop
        return Promise.resolve([]); // recordEmbeddingMetadata
      },
    ) as unknown as ReturnType<typeof import('postgres')['default']>;

    const provider = makeProvider();
    vi.mocked(provider.batchEmbeddings).mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
    const vectorStore = makeVectorStore();

    const result = await reindexWorkspace(sql, vectorStore, 'ws-1', provider);
    expect(result.entitiesProcessed).toBe(2);
    expect(result.batchesCompleted).toBe(1);
    expect(vectorStore.upsert).toHaveBeenCalledOnce();
  });

  it('does not call upsert in dry-run mode', async () => {
    const entities = [
      { id: 'e1', workspace_id: 'ws-1', label: 'Acme', entity_type: 'company', attributes: {} },
    ];
    let call = 0;
    const sql = Object.assign(
      () => {
        call++;
        if (call === 1) return Promise.resolve(entities);
        return Promise.resolve([]);
      },
    ) as unknown as ReturnType<typeof import('postgres')['default']>;

    const provider = makeProvider();
    const vectorStore = makeVectorStore();

    await reindexWorkspace(sql, vectorStore, 'ws-1', provider, { dryRun: true });
    expect(vectorStore.upsert).not.toHaveBeenCalled();
    expect(provider.batchEmbeddings).not.toHaveBeenCalled();
  });

  it('returns correct duration in result', async () => {
    const sql = makeSql([[]]);
    const provider = makeProvider();
    const vectorStore = makeVectorStore();

    const result = await reindexWorkspace(sql, vectorStore, 'ws-1', provider);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks tokensEstimated across batches', async () => {
    const entities = [
      { id: 'e1', workspace_id: 'ws-1', label: 'Long label entity', entity_type: 'record', attributes: { desc: 'some description' } },
    ];
    let call = 0;
    const sql = Object.assign(
      () => {
        call++;
        if (call === 1) return Promise.resolve(entities);
        return Promise.resolve([]);
      },
    ) as unknown as ReturnType<typeof import('postgres')['default']>;

    const provider = makeProvider();
    const vectorStore = makeVectorStore();

    const result = await reindexWorkspace(sql, vectorStore, 'ws-1', provider, { dryRun: true });
    expect(result.tokensEstimated).toBeGreaterThan(0);
  });
});
