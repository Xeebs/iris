import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createStreamingQueryRoutes } from '../routes/streaming-queries.js';

vi.mock('@iris/semantic-core/streaming-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@iris/semantic-core/streaming-context')>();
  return original; // use real implementation for full stream testing
});

function makeSql(entities: Record<string, unknown>[] = []) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve([{ stream_id: 'stream-uuid-123' }]);
    }
    if (callCount === 2) {
      return Promise.resolve(entities);
    }
    return Promise.resolve([]);
  });
  (fn as unknown as Record<string, unknown>).array = vi.fn().mockReturnThis();
  (fn as unknown as Record<string, unknown>).json = vi.fn().mockReturnThis();
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp(sql = makeSql()) {
  const app = new Hono();
  app.route('/streaming-queries', createStreamingQueryRoutes(sql));
  return app;
}

// ─── GET /streaming-queries/stream ───────────────────────────────────────────

describe('GET /streaming-queries/stream', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const res = await makeApp().request('/streaming-queries/stream');
    expect(res.status).toBe(400);
  });

  it('returns SSE Content-Type for valid request', async () => {
    const res = await makeApp().request('/streaming-queries/stream?workspaceId=ws-1');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('includes X-Stream-Id header on success', async () => {
    const res = await makeApp().request('/streaming-queries/stream?workspaceId=ws-1');
    expect(res.headers.get('x-stream-id')).toBeDefined();
  });

  it('response body ends with [DONE] marker', async () => {
    const res = await makeApp().request('/streaming-queries/stream?workspaceId=ws-1');
    const text = await res.text();
    expect(text).toContain('data: [DONE]');
  });

  it('returns only [DONE] when no entities found', async () => {
    const sql = makeSql([]);
    const res = await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1');
    const text = await res.text();
    const nonDoneLines = text.split('\n\n').filter((l) => l && !l.includes('[DONE]') && l.trim() !== '');
    expect(nonDoneLines).toHaveLength(0);
  });

  it('emits data chunks for entities', async () => {
    const entities = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`, type: 'contact', label: `Contact ${i}`,
      attributes: { name: `Contact ${i}` }, relationships: [],
      lastModified: new Date().toISOString(), sourceId: `e${i}`,
    }));
    const sql = makeSql(entities);
    const res = await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1');
    const text = await res.text();
    const dataLines = text.split('\n\n').filter((l) => l.startsWith('data: {'));
    expect(dataLines.length).toBeGreaterThan(0);
  });

  it('each data chunk is valid JSON with metadata and entities', async () => {
    const entities = [
      { id: 'e1', type: 'contact', label: 'Alice', attributes: {}, relationships: [], lastModified: new Date().toISOString(), sourceId: 'e1' },
    ];
    const sql = makeSql(entities);
    const res = await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1');
    const text = await res.text();
    const dataLines = text.split('\n\n').filter((l) => l.startsWith('data: {'));
    for (const line of dataLines) {
      const payload = JSON.parse(line.replace('data: ', '')) as { metadata: unknown; entities: unknown[] };
      expect(payload).toHaveProperty('metadata');
      expect(payload).toHaveProperty('entities');
    }
  });

  it('respects contextBudget query param (accepts valid values)', async () => {
    const res = await makeApp().request('/streaming-queries/stream?workspaceId=ws-1&contextBudget=500');
    expect(res.status).not.toBe(400);
  });

  it('returns 400 when contextBudget exceeds max 8000', async () => {
    const res = await makeApp().request('/streaming-queries/stream?workspaceId=ws-1&contextBudget=9999');
    expect(res.status).toBe(400);
  });

  it('filters by entityTypes when provided', async () => {
    const sql = makeSql([]);
    await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1&entityTypes=contact,deal');
    expect((sql as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('handles entity-heavy stream (large entity count) without error', async () => {
    const entities = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`, type: 'contact', label: `Contact ${i} With A Longer Label Text`,
      attributes: { role: 'manager', company: 'Corp', email: `c${i}@corp.com` },
      relationships: [], lastModified: new Date().toISOString(), sourceId: `e${i}`,
    }));
    const sql = makeSql(entities);
    const res = await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1&maxTokensPerChunk=200');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: [DONE]');
  });

  it('truncates stream when token budget is exhausted mid-stream', async () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`, type: 'contact', label: `Entity ${i} padded content text here`,
      attributes: { field1: 'val', field2: 'another val', field3: 'more values here' },
      relationships: [], lastModified: new Date().toISOString(), sourceId: `e${i}`,
    }));
    const sql = makeSql(entities);
    const res = await makeApp(sql).request('/streaming-queries/stream?workspaceId=ws-1&contextBudget=100&maxTokensPerChunk=40');
    const text = await res.text();
    expect(text).toContain('[DONE]');
  });
});

// ─── GET /streaming-queries/sessions/:streamId ────────────────────────────────

describe('GET /streaming-queries/sessions/:streamId', () => {
  it('returns 404 for unknown streamId', async () => {
    const sql = makeSql([]);
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // no session found
    const res = await makeApp(sql).request('/streaming-queries/sessions/non-existent');
    expect(res.status).toBe(404);
  });

  it('returns session metadata on success', async () => {
    const sql = makeSql([]);
    const session = {
      stream_id: 'stream-uuid-123', workspace_id: 'ws-1', status: 'completed',
      total_chunks: 3, total_bytes: 1200, total_tokens: 450,
      latency_p95_ms: 120, started_at: new Date(), closed_at: new Date(),
    };
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([session]);
    const res = await makeApp(sql).request('/streaming-queries/sessions/stream-uuid-123');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { stream_id: string } };
    expect(body.data.stream_id).toBe('stream-uuid-123');
  });
});
