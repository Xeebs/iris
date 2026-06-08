import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createEntityValidationRoutes } from '../routes/entity-validation.js';

// ─── Mock sql ─────────────────────────────────────────────────────────────────

const mockSql = vi.fn().mockResolvedValue([]);

function makeApp() {
  const routes = createEntityValidationRoutes(mockSql as never);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    c.set('userId', 'user-test');
    await next();
  });
  app.route('/validation', routes);
  return app;
}

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    rule_id: 'rule-uuid',
    workspace_id: 'ws-test',
    entity_type: 'contact',
    rule_name: 'Email required',
    rule_definition: { type: 'required', field: 'email' },
    is_blocking: true,
    severity: 'error',
    created_by_user_id: 'user-test',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Entity Validation Routes', () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  // ── POST /rules ────────────────────────────────────────────────────────────

  describe('POST /validation/rules', () => {
    it('returns 201 with created rule', async () => {
      mockSql.mockResolvedValueOnce([makeRuleRow()]);

      const res = await app.request('/validation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'contact',
          ruleName: 'Email required',
          definition: { type: 'required', field: 'email' },
          isBlocking: true,
          severity: 'error',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { ruleId: string } };
      expect(body.data.ruleId).toBe('rule-uuid');
    });

    it('returns 400 for invalid definition', async () => {
      const res = await app.request('/validation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: '', ruleName: '', definition: { type: 'unknown' } }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is missing required fields', async () => {
      const res = await app.request('/validation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /rules ─────────────────────────────────────────────────────────────

  describe('GET /validation/rules', () => {
    it('returns list of rules', async () => {
      mockSql.mockResolvedValueOnce([makeRuleRow()]);
      const res = await app.request('/validation/rules');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('accepts entityType filter', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/validation/rules?entityType=deal');
      expect(res.status).toBe(200);
    });
  });

  // ── DELETE /rules/:ruleId ──────────────────────────────────────────────────

  describe('DELETE /validation/rules/:ruleId', () => {
    it('returns 200 on success', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/validation/rules/rule-uuid', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });
  });

  // ── POST /validate-entity ─────────────────────────────────────────────────

  describe('POST /validation/validate-entity', () => {
    it('validates a well-formed entity and returns result', async () => {
      mockSql.mockResolvedValueOnce([makeRuleRow()]);

      const res = await app.request('/validation/validate-entity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: {
            id: 'contact:1',
            type: 'contact',
            label: 'Alice',
            attributes: { email: 'alice@example.com' },
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { valid: boolean } };
      expect(typeof body.data.valid).toBe('boolean');
    });

    it('returns 400 for malformed entity payload', async () => {
      const res = await app.request('/validation/validate-entity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: {} }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /failures ─────────────────────────────────────────────────────────

  describe('GET /validation/failures', () => {
    it('returns paginated failures', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/validation/failures');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.meta.hasMore).toBe('boolean');
    });

    it('accepts acknowledged filter', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/validation/failures?acknowledged=false');
      expect(res.status).toBe(200);
    });

    it('rejects limit > 200', async () => {
      const res = await app.request('/validation/failures?limit=999');
      expect(res.status).toBe(400);
    });
  });

  // ── POST /failures/:failureId/acknowledge ─────────────────────────────────

  describe('POST /validation/failures/:failureId/acknowledge', () => {
    it('returns acknowledged true', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/validation/failures/f-uuid/acknowledge', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { acknowledged: boolean } };
      expect(body.data.acknowledged).toBe(true);
    });
  });

  // ── GET /report ───────────────────────────────────────────────────────────

  describe('GET /validation/report', () => {
    it('returns report with counts', async () => {
      mockSql
        .mockResolvedValueOnce([{ total: 50 }])
        .mockResolvedValueOnce([]);

      const res = await app.request('/validation/report');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { totalEntities: number } };
      expect(body.data.totalEntities).toBe(50);
    });
  });
});
