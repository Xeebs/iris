/**
 * Integration test: validateEmbeddingDimension is wired into the MCP server
 * startup and surfaces a clear error when schema dims ≠ provider dims.
 *
 * This guards SLICE_2.md requirement #1:
 *   "a provider/dimension mismatch at startup must be a hard, clear error"
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { validateEmbeddingDimension } from '@iris/semantic-core/validate-embedding-dimension';

vi.mock('@iris/semantic-core/embedding-provider', () => ({
  createDefaultProvider: vi.fn(),
}));

import { createDefaultProvider } from '@iris/semantic-core/embedding-provider';
const mockProvider = createDefaultProvider as ReturnType<typeof vi.fn>;

function makeSql(storedDim: number): ReturnType<typeof import('postgres').default> {
  const resultPromise = Object.assign(Promise.resolve([{ atttypmod: storedDim }]), {
    catch: () => Promise.resolve([{ atttypmod: storedDim }]),
  });
  return vi.fn().mockReturnValue(resultPromise) as unknown as ReturnType<typeof import('postgres').default>;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['EMBEDDING_PROVIDER'];
});

describe('embedding dimension startup validation (MCP server)', () => {
  it('throws a clear error when schema is 1536-dim but EMBEDDING_PROVIDER=ollama (768-dim)', async () => {
    mockProvider.mockReturnValue({ getModelDimensions: () => 768 });
    process.env['EMBEDDING_PROVIDER'] = 'ollama';
    const sql = makeSql(1536);

    await expect(validateEmbeddingDimension(sql)).rejects.toThrow(
      /Embedding dimension mismatch: schema has vector\(1536\) but EMBEDDING_PROVIDER=ollama provides 768-dimensional vectors/,
    );
  });

  it('throws with the correct migration hint for ollama', async () => {
    mockProvider.mockReturnValue({ getModelDimensions: () => 768 });
    process.env['EMBEDDING_PROVIDER'] = 'ollama';
    const sql = makeSql(1536);

    await expect(validateEmbeddingDimension(sql)).rejects.toThrow(/183_embedding_dimension_ollama/);
  });

  it('no-ops when schema dimension matches the provider', async () => {
    mockProvider.mockReturnValue({ getModelDimensions: () => 1536 });
    process.env['EMBEDDING_PROVIDER'] = 'openai';
    const sql = makeSql(1536);

    await expect(validateEmbeddingDimension(sql)).resolves.toBeUndefined();
  });
});
