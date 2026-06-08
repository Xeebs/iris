import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createStreamingContextRoutes } from '../routes/streaming-context.js';

/**
 * Integration tests for the streaming context API.
 * Requires Postgres running via docker-compose up -d.
 * Run with: pnpm test:integration
 */

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(connectionString);
});

afterAll(async () => {
  await sql.end();
});

describe('createStreamingContextRoutes integration', () => {
  it('returns 400 for missing query parameter', async () => {
    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-integration' },
      body: JSON.stringify({ tokenBudget: 2000 }),
    });
    expect(res.status).toBe(400);
  });

  it('streams SSE response for valid query on empty index', async () => {
    const app = createStreamingContextRoutes(sql);
    const res = await app.request('/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-integration' },
      body: JSON.stringify({ query: 'test query integration', tokenBudget: 500 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});
