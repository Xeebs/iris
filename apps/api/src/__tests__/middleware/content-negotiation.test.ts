import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { contentNegotiationMiddleware } from '../../middleware/content-negotiation.js';

vi.mock('@iris/semantic-core/response-serializer', () => ({
  selectFormat: vi.fn().mockImplementation((accept: string | undefined) => {
    if (accept?.includes('text/csv')) return 'csv';
    if (accept?.includes('application/octet-stream')) return 'parquet';
    return 'json';
  }),
  contentTypeFor: vi.fn().mockImplementation((fmt: string) => {
    if (fmt === 'csv') return 'text/csv';
    if (fmt === 'parquet') return 'application/octet-stream';
    return 'application/json';
  }),
  contentDispositionFor: vi.fn().mockImplementation((fmt: string) => {
    if (fmt === 'csv') return 'attachment; filename="export.csv"';
    if (fmt === 'parquet') return 'attachment; filename="export.parquet"';
    return null;
  }),
}));

import { vi } from 'vitest';

function makeApp() {
  const app = new Hono();
  app.use('*', contentNegotiationMiddleware);
  app.get('/test', (c) => {
    const fmt = c.get('responseFormat') as string;
    return c.json({ format: fmt });
  });
  return app;
}

describe('contentNegotiationMiddleware', () => {
  it('defaults to json when no Accept header', async () => {
    const res = await makeApp().request('/test');
    const body = await res.json() as { format: string };
    expect(body.format).toBe('json');
  });

  it('selects csv when Accept: text/csv', async () => {
    const res = await makeApp().request('/test', { headers: { accept: 'text/csv' } });
    const body = await res.json() as { format: string };
    expect(body.format).toBe('csv');
  });

  it('respects ?format=csv query param over Accept header', async () => {
    const res = await makeApp().request('/test?format=csv', { headers: { accept: 'application/json' } });
    const body = await res.json() as { format: string };
    expect(body.format).toBe('csv');
  });

  it('ignores unknown ?format= values and falls back to header negotiation', async () => {
    const res = await makeApp().request('/test?format=xml');
    const body = await res.json() as { format: string };
    expect(body.format).toBe('json');
  });

  it('sets Content-Type header from negotiated format', async () => {
    const res = await makeApp().request('/test?format=csv');
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('sets Content-Disposition header for csv', async () => {
    const res = await makeApp().request('/test?format=csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('does not set Content-Disposition for json', async () => {
    const res = await makeApp().request('/test');
    expect(res.headers.get('content-disposition')).toBeNull();
  });

  it('injects responseFormat into context', async () => {
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
    const body = await res.json() as { format: string };
    expect(['json', 'csv', 'parquet']).toContain(body.format);
  });
});
