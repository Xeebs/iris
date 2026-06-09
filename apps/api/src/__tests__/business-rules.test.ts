import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeBusinessRulesRouter } from '../routes/business-rules.js';

vi.mock('@iris/semantic-core/business-rule-engine', () => {
  const { ok } = require('neverthrow');
  const sampleRule = {
    id: 'rule-1', name: 'Email required', entityType: 'contact',
    conditions: [{ field: 'email', operator: 'required' }],
    action: 'warn', severity: 'warning', description: 'Contacts must have email',
    active: true, createdAt: new Date(),
  };
  const MockRuleEngine = vi.fn().mockImplementation(() => ({
    listRules: vi.fn().mockResolvedValue(ok([sampleRule])),
    defineRule: vi.fn().mockResolvedValue(ok(sampleRule)),
    evaluateEntity: vi.fn().mockResolvedValue(ok([])),
    trackRuleViolations: vi.fn().mockResolvedValue(ok([
      { ruleId: 'rule-1', ruleName: 'Email required', violationCount: 5, severity: 'warning' },
    ])),
    autoCorrectViolations: vi.fn().mockResolvedValue(ok([
      { entityId: 'e1', ruleId: 'rule-1', field: 'name', oldValue: '  John  ', newValue: 'John', applied: true },
    ])),
  }));
  return { RuleEngine: MockRuleEngine };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/admin/rules', makeBusinessRulesRouter(makeSql()));
  return app;
}

describe('GET /api/v1/admin/rules', () => {
  it('returns rule list', async () => {
    const res = await makeApp().request('/api/v1/admin/rules');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('accepts entityType filter', async () => {
    const res = await makeApp().request('/api/v1/admin/rules?entityType=contact');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/admin/rules', () => {
  it('creates rule and returns 201', async () => {
    const res = await makeApp().request('/api/v1/admin/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Email required', entityType: 'contact',
        conditions: [{ field: 'email', operator: 'required' }],
        action: 'warn', severity: 'warning',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Email required');
  });

  it('returns 400 for invalid body', async () => {
    const res = await makeApp().request('/api/v1/admin/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty conditions', async () => {
    const res = await makeApp().request('/api/v1/admin/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', entityType: 'contact', conditions: [], action: 'warn', severity: 'info' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/rules/validate', () => {
  it('returns valid: true when no violations', async () => {
    const res = await makeApp().request('/api/v1/admin/rules/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'e1', type: 'contact', attributes: { email: 'test@example.com' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { valid: boolean; violations: unknown[] } };
    expect(body.data.valid).toBe(true);
    expect(body.data.violations).toHaveLength(0);
  });

  it('returns 400 for missing type', async () => {
    const res = await makeApp().request('/api/v1/admin/rules/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'e1', attributes: {} }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/rules/violations', () => {
  it('returns violation stats', async () => {
    const res = await makeApp().request('/api/v1/admin/rules/violations');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /api/v1/admin/rules/auto-fix', () => {
  it('applies corrections and returns summary', async () => {
    const res = await makeApp().request('/api/v1/admin/rules/auto-fix', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityIds: ['e1', 'e2'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { applied: number; skipped: number } };
    expect(body.data.applied).toBe(1);
  });

  it('returns 400 for empty entityIds', async () => {
    const res = await makeApp().request('/api/v1/admin/rules/auto-fix', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});
