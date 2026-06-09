import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError, z } from 'zod';
import { errorHandler } from '../../middleware/error-handler.js';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps HTTPException to its status code', async () => {
    const app = makeApp();
    app.get('/test', () => { throw new HTTPException(404, { message: 'Not here' }); });
    const res = await app.request('/test');
    expect(res.status).toBe(404);
  });

  it('returns structured error envelope for HTTPException', async () => {
    const app = makeApp();
    app.get('/test', () => { throw new HTTPException(403, { message: 'Forbidden' }); });
    const res = await app.request('/test');
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('HTTP_ERROR');
    expect(body.error.message).toBe('Forbidden');
  });

  it('maps ZodError to 400 with VALIDATION_ERROR code', async () => {
    const app = makeApp();
    app.get('/test', () => {
      const schema = z.object({ name: z.string() });
      schema.parse({});
    });
    const res = await app.request('/test');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ZodError response includes validation details', async () => {
    const app = makeApp();
    app.get('/test', () => {
      const schema = z.object({ age: z.number() });
      schema.parse({ age: 'not-a-number' });
    });
    const res = await app.request('/test');
    const body = await res.json() as { error: { details: unknown[] } };
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('maps unknown errors to 500 with INTERNAL_ERROR code', async () => {
    const app = makeApp();
    app.get('/test', () => { throw new Error('Unexpected boom'); });
    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('does not leak stack traces in 500 response', async () => {
    const app = makeApp();
    app.get('/test', () => { throw new Error('secret internal details'); });
    const res = await app.request('/test');
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).not.toContain('secret internal details');
  });

  it('returns JSON content-type', async () => {
    const app = makeApp();
    app.get('/test', () => { throw new Error('boom'); });
    const res = await app.request('/test');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
