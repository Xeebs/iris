import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockService = {
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  upsertFieldConfig: vi.fn(),
  deleteFieldConfig: vi.fn(),
};

vi.mock('@iris/semantic-core/pii-masker', () => ({
  PiiConfigService: vi.fn(() => mockService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}));

import { createPiiConfigRoutes } from '../routes/pii-config.js';

const SAMPLE_CONFIG = {
  workspaceId: 'ws-1',
  enableAutoDetection: true,
  defaultStrategy: 'redact' as const,
  fields: [
    { fieldName: 'email', strategy: 'hash' },
    { fieldName: 'phone', strategy: 'redact' },
  ],
};

function buildApp() {
  const app = new Hono();
  app.route('/pii-config', createPiiConfigRoutes({} as never));
  return app;
}

describe('pii-config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns 200 with full config', async () => {
      mockService.getConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_CONFIG };
      expect(body.data.enableAutoDetection).toBe(true);
      expect(body.data.defaultStrategy).toBe('redact');
    });

    it('returns 400 when workspaceId is missing', async () => {
      const res = await buildApp().request('/pii-config');
      expect(res.status).toBe(400);
    });

    it('returns 500 when service fails', async () => {
      mockService.getConfig.mockResolvedValueOnce(err(new Error('DB error')));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1');
      expect(res.status).toBe(500);
    });

    it('includes fields array in response', async () => {
      mockService.getConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1');
      const body = await res.json() as { data: { fields: unknown[] } };
      expect(Array.isArray(body.data.fields)).toBe(true);
      expect(body.data.fields).toHaveLength(2);
    });

    it('passes workspaceId to service', async () => {
      mockService.getConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      await buildApp().request('/pii-config?workspaceId=my-workspace');
      expect(mockService.getConfig).toHaveBeenCalledWith('my-workspace');
    });
  });

  describe('PUT /', () => {
    it('upserts config and returns 200 with ok=true', async () => {
      mockService.upsertConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'redact' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { ok: boolean } };
      expect(body.data.ok).toBe(true);
    });

    it('returns 400 when workspaceId is missing', async () => {
      const res = await buildApp().request('/pii-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'redact' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when defaultStrategy is invalid', async () => {
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: true, defaultStrategy: 'encrypt' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when enableAutoDetection is missing', async () => {
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultStrategy: 'hash' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 when service fails', async () => {
      mockService.upsertConfig.mockResolvedValueOnce(err(new Error('Write error')));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: false, defaultStrategy: 'hash' }),
      });
      expect(res.status).toBe(500);
    });

    it('accepts tokenize as valid strategy', async () => {
      mockService.upsertConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enableAutoDetection: true,
          defaultStrategy: 'tokenize',
          tokenizationKey: 'my-secret-key-16chars',
        }),
      });
      expect(res.status).toBe(200);
    });

    it('accepts hash as valid strategy', async () => {
      mockService.upsertConfig.mockResolvedValueOnce(ok(SAMPLE_CONFIG));
      const res = await buildApp().request('/pii-config?workspaceId=ws-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAutoDetection: false, defaultStrategy: 'hash' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /fields', () => {
    it('adds a field rule and returns 201', async () => {
      mockService.upsertFieldConfig.mockResolvedValueOnce(ok(undefined));
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'ssn', strategy: 'redact' }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 when workspaceId is missing', async () => {
      const res = await buildApp().request('/pii-config/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'ssn', strategy: 'redact' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when fieldName is missing', async () => {
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: 'redact' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when strategy is invalid', async () => {
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'email', strategy: 'delete' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 when service fails', async () => {
      mockService.upsertFieldConfig.mockResolvedValueOnce(err(new Error('Write error')));
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'email', strategy: 'hash' }),
      });
      expect(res.status).toBe(500);
    });

    it('passes customPattern to service when provided', async () => {
      mockService.upsertFieldConfig.mockResolvedValueOnce(ok(undefined));
      await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'custom_id', strategy: 'hash', customPattern: '^[A-Z]{2}\\d+$' }),
      });
      expect(mockService.upsertFieldConfig).toHaveBeenCalledWith(
        'ws-1',
        'custom_id',
        'hash',
        '^[A-Z]{2}\\d+$'
      );
    });
  });

  describe('DELETE /fields', () => {
    it('deletes a field rule and returns deleted flag', async () => {
      mockService.deleteFieldConfig.mockResolvedValueOnce(ok(true));
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'email' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });

    it('returns deleted=false when field did not exist', async () => {
      mockService.deleteFieldConfig.mockResolvedValueOnce(ok(false));
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'nonexistent' }),
      });
      const body = await res.json() as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(false);
    });

    it('returns 400 when workspaceId is missing', async () => {
      const res = await buildApp().request('/pii-config/fields', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'email' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when fieldName is missing from body', async () => {
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 when service fails', async () => {
      mockService.deleteFieldConfig.mockResolvedValueOnce(err(new Error('Delete error')));
      const res = await buildApp().request('/pii-config/fields?workspaceId=ws-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldName: 'email' }),
      });
      expect(res.status).toBe(500);
    });
  });
});
