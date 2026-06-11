import { describe, it, expect, vi, afterEach } from 'vitest';

import { validateEmbeddingDimension } from '../validate-embedding-dimension.js';

// Mock the embedding provider so tests control the expected dimension.
vi.mock('../embedding-provider.js', () => ({
  createDefaultProvider: vi.fn(),
}));

import { createDefaultProvider } from '../embedding-provider.js';

const mockCreateDefaultProvider = createDefaultProvider as ReturnType<typeof vi.fn>;

function makeSql(atttypmod: number | null): ReturnType<typeof import('postgres').default> {
  // Minimal postgres.js template-tag mock.
  const sql = vi.fn().mockImplementation(() => {
    if (atttypmod === null) {
      return Promise.resolve([]); // table does not exist
    }
    return Promise.resolve([{ atttypmod }]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  // Add the .catch chaining used in validateEmbeddingDimension.
  (sql as unknown as { catch: (fn: () => unknown[]) => Promise<unknown[]> }).catch = () =>
    Promise.resolve([]);
  return sql;
}

// A postgres.js template-tag call returns a thenable; override the mock to
// support the `.catch()` fall-through.
function makeSqlWithCatch(atttypmod: number | null): ReturnType<typeof import('postgres').default> {
  const resultPromise =
    atttypmod === null
      ? Object.assign(Promise.resolve([]), { catch: () => Promise.resolve([]) })
      : Object.assign(Promise.resolve([{ atttypmod }]), {
          catch: () => Promise.resolve([{ atttypmod }]),
        });

  const sql = vi.fn().mockReturnValue(resultPromise) as unknown as ReturnType<
    typeof import('postgres').default
  >;
  return sql;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['EMBEDDING_PROVIDER'];
});

describe('validateEmbeddingDimension', () => {
  describe('when iris_entities does not exist', () => {
    it('no-ops without throwing', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 768 });
      const sql = makeSqlWithCatch(null);

      await expect(validateEmbeddingDimension(sql)).resolves.toBeUndefined();
    });
  });

  describe('when embedding column has no dimension constraint (atttypmod = -1)', () => {
    it('no-ops without throwing', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 1536 });
      const sql = makeSqlWithCatch(-1);

      await expect(validateEmbeddingDimension(sql)).resolves.toBeUndefined();
    });
  });

  describe('when stored dimension matches the provider', () => {
    it('no-ops for 1536-dim OpenAI match', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 1536 });
      process.env['EMBEDDING_PROVIDER'] = 'openai';
      const sql = makeSqlWithCatch(1536);

      await expect(validateEmbeddingDimension(sql)).resolves.toBeUndefined();
    });

    it('no-ops for 768-dim Ollama match', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 768 });
      process.env['EMBEDDING_PROVIDER'] = 'ollama';
      const sql = makeSqlWithCatch(768);

      await expect(validateEmbeddingDimension(sql)).resolves.toBeUndefined();
    });
  });

  describe('when stored dimension does not match the provider', () => {
    it('throws IndexerError with migration 183 hint for ollama provider', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 768 });
      process.env['EMBEDDING_PROVIDER'] = 'ollama';
      const sql = makeSqlWithCatch(1536); // schema is 1536 but ollama wants 768

      await expect(validateEmbeddingDimension(sql)).rejects.toThrow(
        /Embedding dimension mismatch: schema has vector\(1536\) but EMBEDDING_PROVIDER=ollama provides 768-dimensional vectors/,
      );
      await expect(validateEmbeddingDimension(sql)).rejects.toThrow(/183_embedding_dimension_ollama/);
    });

    it('throws IndexerError with migration 182 hint for openai provider', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 1536 });
      process.env['EMBEDDING_PROVIDER'] = 'openai';
      const sql = makeSqlWithCatch(768); // schema is 768 but openai wants 1536

      await expect(validateEmbeddingDimension(sql)).rejects.toThrow(
        /Embedding dimension mismatch: schema has vector\(768\) but EMBEDDING_PROVIDER=openai provides 1536-dimensional vectors/,
      );
      await expect(validateEmbeddingDimension(sql)).rejects.toThrow(/182_embedding_dimension_768/);
    });

    it('error message includes CONNECT_CLAUDE.md reference', async () => {
      mockCreateDefaultProvider.mockReturnValue({ getModelDimensions: () => 768 });
      process.env['EMBEDDING_PROVIDER'] = 'ollama';
      const sql = makeSqlWithCatch(1536);

      await expect(validateEmbeddingDimension(sql)).rejects.toThrow(/CONNECT_CLAUDE/);
    });
  });
});
