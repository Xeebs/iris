import { describe, it, expect, vi } from 'vitest';
import { makeEntityLifecycleRouter, makeLifecycleAdminRouter } from '../routes/entity-lifecycle.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/entity-lifecycle', async () => {
  const actual = await vi.importActual('@iris/semantic-core/entity-lifecycle') as typeof import('@iris/semantic-core/entity-lifecycle');
  const { ok, err } = await import('neverthrow');

  class MockEntityLifecycleManager {
    defineEntityStatus = vi.fn().mockResolvedValue(ok({ id: 'ev1', entityId: 'e1', fromStatus: 'DRAFT', toStatus: 'PUBLISHED', reason: 'ready', actor: 'admin', metadata: {}, occurredAt: new Date() }));
    trackStatusHistory = vi.fn().mockResolvedValue(ok([
      { id: 'ev1', entityId: 'e1', fromStatus: 'DRAFT', toStatus: 'PUBLISHED', reason: 'ready', actor: 'admin', metadata: {}, occurredAt: new Date() },
    ]));
    approveEntity = vi.fn().mockResolvedValue(ok({ id: 'ap1', entityId: 'e1', approverId: 'approver-1', conditions: null, approvedAt: new Date() }));
    deprecateEntity = vi.fn().mockResolvedValue(ok({ id: 'ev2', entityId: 'e1', fromStatus: 'PUBLISHED', toStatus: 'DEPRECATED', reason: 'Entity deprecated', actor: 'admin', metadata: {}, occurredAt: new Date() }));
    computeEntityHealthScore = vi.fn().mockResolvedValue(ok({ entityId: 'e1', score: 78, recencyFactor: 80, approvalFactor: 40, statusFactor: 20, breakdown: { recency: 32, approval: 16, status: 20 } }));
    queryEntitiesByLifecycle = vi.fn().mockResolvedValue(ok({ states: [{ entityId: 'e1', currentStatus: 'PUBLISHED', approvalCount: 2, lastTransitionAt: new Date(), sunsetDate: null, replacementEntityId: null }], nextCursor: null }));
    getLifecycleDashboard = vi.fn().mockResolvedValue(ok({ totalByStatus: { DRAFT: 5, PUBLISHED: 20, DEPRECATED: 3, ARCHIVED: 1 }, pendingApprovals: 4, deprecatedCount: 3, archivedCount: 1, atRiskEntities: ['e1', 'e2'] }));
  }

  return { ...actual, EntityLifecycleManager: MockEntityLifecycleManager };
});

function makeApp() {
  const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
  return { entity: makeEntityLifecycleRouter(sql), admin: makeLifecycleAdminRouter(sql) };
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /entities/:id/lifecycle', () => {
  it('returns history and health score', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.entityId).toBe('e1');
    expect(body.data.history).toHaveLength(1);
    expect(body.data.healthScore.score).toBe(78);
  });
});

describe('PUT /entities/:id/lifecycle/status', () => {
  it('transitions status successfully', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'PUBLISHED', reason: 'Ready for production', actor: 'admin' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.toStatus).toBe('PUBLISHED');
  });

  it('returns 400 for invalid status', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'LIMBO', reason: 'test', actor: 'admin' }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing reason', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'PUBLISHED', actor: 'admin' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /entities/:id/lifecycle/approve', () => {
  it('records approval', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/approve', {
      method: 'POST',
      body: JSON.stringify({ approverId: 'approver-1' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.approverId).toBe('approver-1');
  });

  it('returns 400 for missing approverId', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/approve', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /entities/:id/lifecycle/deprecate', () => {
  it('deprecates with replacement', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/deprecate', {
      method: 'POST',
      body: JSON.stringify({ actor: 'admin', replacementEntityId: 'e2', sunsetDate: '2027-01-01T00:00:00Z' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.toStatus).toBe('DEPRECATED');
  });

  it('returns 400 for missing actor', async () => {
    const { entity } = makeApp();
    const res = await entity.fetch(req('/e1/lifecycle/deprecate', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/lifecycle/dashboard', () => {
  it('returns lifecycle dashboard', async () => {
    const { admin } = makeApp();
    const res = await admin.fetch(req('/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalByStatus.PUBLISHED).toBe(20);
    expect(body.data.pendingApprovals).toBe(4);
    expect(body.data.atRiskEntities).toContain('e1');
  });
});

describe('GET /admin/lifecycle/entities', () => {
  it('returns paginated entity lifecycle states', async () => {
    const { admin } = makeApp();
    const res = await admin.fetch(req('/entities?status=PUBLISHED'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].currentStatus).toBe('PUBLISHED');
    expect(body.meta).toHaveProperty('hasMore');
  });

  it('returns 400 for invalid status filter', async () => {
    const { admin } = makeApp();
    const res = await admin.fetch(req('/entities?status=LIMBO'));
    expect(res.status).toBe(400);
  });
});
