import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { apiVersionMiddleware } from '../../middleware/api-version.js';

function makeApp() {
  const app = new Hono();
  app.use('*', apiVersionMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('apiVersionMiddleware', () => {
  it('accepts v1 header and sets apiVersion context', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v1' } });
    expect(res.status).toBe(200);
  });

  it('accepts v2 header', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v2' } });
    expect(res.status).toBe(200);
  });

  it('rejects unsupported version with 400', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v99' } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('API_VERSION_UNSUPPORTED');
  });

  it('defaults to latest version when header is absent', async () => {
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
  });

  it('adds Deprecation header for v1 (deprecated)', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v1' } });
    expect(res.headers.get('Deprecation')).toBeTruthy();
  });

  it('adds Sunset header for v1', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v1' } });
    expect(res.headers.get('Sunset')).toBeTruthy();
  });

  it('adds Warning header for v1', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v1' } });
    const warning = res.headers.get('Warning') ?? '';
    expect(warning).toContain('deprecated');
  });

  it('does not add Deprecation header for v2 (active)', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v2' } });
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('rejects a clearly invalid version string', async () => {
    const res = await makeApp().request('/test', { headers: { 'x-api-version': 'v999' } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('API_VERSION_UNSUPPORTED');
  });
});
