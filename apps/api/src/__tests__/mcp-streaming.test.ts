import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createMcpStreamingRoutes } from '../routes/mcp-streaming.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/mcp', createMcpStreamingRoutes());
  return app;
}

const sampleEntity = {
  id: 'hubspot:contact:1',
  type: 'contact',
  label: 'Alice Smith',
  attributes: { email: 'alice@example.com', stage: 'customer' },
  relationships: [],
  lastModified: '2026-01-10T00:00:00.000Z',
  sourceId: 'hubspot:contact:1',
};

const validBody = { entities: [sampleEntity] };

describe('GET /api/v1/mcp/stream/config', () => {
  it('returns config info', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { defaultMaxTokensPerChunk: number } };
    expect(body.data.defaultMaxTokensPerChunk).toBe(1500);
  });
});

describe('POST /api/v1/mcp/stream', () => {
  it('returns 200 with text/event-stream content type', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('stream body contains SSE data events', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    expect(text).toContain('data: ');
  });

  it('stream ends with [DONE] marker', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    expect(text).toContain('[DONE]');
  });

  it('chunk metadata includes chunkIndex and moreChunks', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    expect(dataLines.length).toBeGreaterThan(0);
    const chunk = JSON.parse(dataLines[0]!.slice('data: '.length)) as { metadata: { chunkIndex: number; moreChunks: boolean } };
    expect(typeof chunk.metadata.chunkIndex).toBe('number');
    expect(typeof chunk.metadata.moreChunks).toBe('boolean');
  });

  it('first chunk has chunkIndex 0', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunk = JSON.parse(dataLines[0]!.slice('data: '.length)) as { metadata: { chunkIndex: number } };
    expect(chunk.metadata.chunkIndex).toBe(0);
  });

  it('single-entity stream has moreChunks=false', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    const chunk = JSON.parse(dataLines[0]!.slice('data: '.length)) as { metadata: { moreChunks: boolean } };
    expect(chunk.metadata.moreChunks).toBe(false);
  });

  it('returns 400 for empty entities array', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entities: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for missing body', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('accepts maxTokensPerChunk parameter', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, maxTokensPerChunk: 500 }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid maxTokensPerChunk (too small)', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/mcp/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, maxTokensPerChunk: 10 }),
    });
    expect(res.status).toBe(400);
  });
});
