import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTransformationRoutes } from '../routes/transformations.js';

const mockSql = vi.fn().mockResolvedValue([]);

function makeApp() {
  const routes = createTransformationRoutes(mockSql as never);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    c.set('userId', 'user-test');
    await next();
  });
  app.route('/transformations', routes);
  return app;
}

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    rule_id: 'r-uuid',
    workspace_id: 'ws-test',
    connector_id: null,
    entity_type: 'contact',
    rule_name: 'Normalize email',
    steps: [{ op: 'normalize_case', field: 'email', mode: 'lower' }],
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const SAMPLE_ENTITY = {
  id: 'contact:1',
  type: 'contact',
  label: 'Alice',
  attributes: { name: '  ALICE  ', email: 'ALICE@EXAMPLE.COM' },
};

describe('Transformation Routes', () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  describe('POST /transformations/rules', () => {
    it('returns 201 with created rule', async () => {
      mockSql.mockResolvedValueOnce([makeRuleRow()]);

      const res = await app.request('/transformations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'contact',
          ruleName: 'Normalize email',
          steps: [{ op: 'normalize_case', field: 'email', mode: 'lower' }],
          isActive: true,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { ruleId: string } };
      expect(body.data.ruleId).toBe('r-uuid');
    });

    it('returns 400 for invalid step op', async () => {
      const res = await app.request('/transformations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: 'Bad rule',
          steps: [{ op: 'invalid_op', field: 'x' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty steps array', async () => {
      const res = await app.request('/transformations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleName: 'Empty', steps: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /transformations/rules', () => {
    it('returns list of rules', async () => {
      mockSql.mockResolvedValueOnce([makeRuleRow()]);
      const res = await app.request('/transformations/rules');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(1);
    });

    it('passes connectorId and entityType filters', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/transformations/rules?connectorId=hubspot&entityType=contact');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /transformations/rules/:ruleId', () => {
    it('returns deleted=true', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await app.request('/transformations/rules/r-uuid', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });
  });

  describe('POST /transformations/test', () => {
    it('returns transformed entity without DB calls', async () => {
      const res = await app.request('/transformations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: SAMPLE_ENTITY,
          steps: [{ op: 'normalize_case', field: 'email', mode: 'lower' }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { output: { attributes: Record<string, unknown> }; stepsApplied: number } };
      expect(body.data.output.attributes['email']).toBe('alice@example.com');
      expect(body.data.stepsApplied).toBe(1);
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('applies multiple steps in sequence', async () => {
      const res = await app.request('/transformations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: SAMPLE_ENTITY,
          steps: [
            { op: 'trim', field: 'name' },
            { op: 'normalize_case', field: 'name', mode: 'title' },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { output: { attributes: Record<string, unknown> } } };
      expect(body.data.output.attributes['name']).toBe('Alice');
    });

    it('returns 400 for invalid step schema', async () => {
      const res = await app.request('/transformations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: SAMPLE_ENTITY,
          steps: [{ op: 'nope' }],
        }),
      });
      expect(res.status).toBe(400);
    });
  });
});
