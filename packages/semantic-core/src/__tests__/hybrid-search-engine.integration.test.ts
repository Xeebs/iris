import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { HybridSearchEngine } from '../hybrid-search-engine.js';

/**
 * Integration tests that require real Postgres + pgvector.
 * Run with: pnpm test:integration (after docker-compose up -d)
 */

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(connectionString);
});

afterAll(async () => {
  await sql.end();
});

describe('HybridSearchEngine integration', () => {
  it('returns empty results on empty index', async () => {
    const engine = new HybridSearchEngine(sql);
    const result = await engine.search({
      workspaceId: 'integration-test-ws',
      query: 'nonexistent entity xyz',
      filters: {},
      limit: 10,
      offset: 0,
      sortBy: 'relevance',
      includeSuggestions: false,
      explainScoring: false,
      hybridWeights: { bm25: 0.4, semantic: 0.6 },
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
  });
});
