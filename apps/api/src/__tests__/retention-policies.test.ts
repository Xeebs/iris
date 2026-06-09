import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { makeRetentionPoliciesRouter } from '../routes/retention-policies.js';

vi.mock('@iris/semantic-core/retention-manager', () => {
  const { ok, err } = require('neverthrow');
  const samplePolicy = {
    id: 'p1', entityType: 'contact', retentionDays: 365, archiveAction: 'soft_delete',
    conditions: [], description: 'Keep contacts 1yr', active: true, createdAt: new Date(),
  };
  const sampleArchived = {
    id: 'a1', entityId: 'e1', entityType: 'contact', reason: 'expired',
    archiveAction: 'cold_storage', archivedAt: new Date(), recoveryWindowDays: 30,
    recoveryDeadline: new Date(Date.now() + 25 * 86400000), restorable: true,
  };
  const MockRetentionPolicyService = vi.fn().mockImplementation(() => ({
    listRetentionPolicies: vi.fn().mockResolvedValue(ok([samplePolicy])),
    defineRetentionPolicy: vi.fn().mockResolvedValue(ok(samplePolicy)),
    queryArchivedEntities: vi.fn().mockResolvedValue(ok({ entities: [sampleArchived], nextCursor: null })),
    restoreArchivedEntity: vi.fn().mockResolvedValue(ok(undefined)),
    archiveEntity: vi.fn().mockResolvedValue(ok(sampleArchived)),
    runArchivalJobScheduled: vi.fn().mockResolvedValue(ok({ archived: 3 })),
  }));
  return { RetentionPolicyService: MockRetentionPolicyService };
});

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql() {
  return vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
}

function makeApp() {
  const app = new Hono();
  app.route('/api/v1/admin/retention-policies', makeRetentionPoliciesRouter(makeSql()));
  return app;
}

describe('GET /api/v1/admin/retention-policies', () => {
  it('returns policy list', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('PUT /api/v1/admin/retention-policies/:type', () => {
  it('upserts policy', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType: 'contact', retentionDays: 365, archiveAction: 'soft_delete' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { retentionDays: number } };
    expect(body.data.retentionDays).toBe(365);
  });

  it('returns 400 for invalid retentionDays', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retentionDays: -1, archiveAction: 'soft_delete' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/retention-policies/archived-entities', () => {
  it('returns archived entities', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/archived-entities');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('accepts entityType filter', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/archived-entities?entityType=contact');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/admin/retention-policies/archived-entities/:id/restore', () => {
  it('restores entity', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/archived-entities/e1/restore', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { restored: boolean } };
    expect(body.data.restored).toBe(true);
  });
});

describe('POST /api/v1/admin/retention-policies/entities/:id/archive', () => {
  it('archives entity and returns 201', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/entities/e1/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'manual_archive' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing reason', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/entities/e1/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/admin/retention-policies/run-archival-job', () => {
  it('runs archival job and returns count', async () => {
    const res = await makeApp().request('/api/v1/admin/retention-policies/run-archival-job', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { archived: number } };
    expect(body.data.archived).toBe(3);
  });
});
