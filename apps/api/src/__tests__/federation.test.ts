import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/federation-manager', () => ({
  registerFederatedWorkspace: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: { id: 'rel1', sourceWorkspaceId: 'ws1', targetWorkspaceId: 'ws2', relationshipType: 'sibling', createdByUserId: 'u1', trustedAt: new Date(), permissions: [{ entityTypePattern: '*', canRead: true, canWrite: false }] },
  })),
  getFederatedRelationships: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: [{ id: 'rel1', sourceWorkspaceId: 'ws1', targetWorkspaceId: 'ws2', relationshipType: 'sibling', createdByUserId: 'u1', trustedAt: new Date(), permissions: [] }],
  })),
  queryFederatedContext: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: { entities: [{ id: 'e1', type: 'contact', label: 'Alice', attributes: {}, sourceWorkspaceId: 'ws2', confidence: 0.9 }], queriedWorkspaces: ['ws2'], totalTokensEstimate: 120, truncated: false, permissionDenied: [] },
  })),
  auditFederatedAccess: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getFederationAuditLog: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: [{ queryId: 'q1', sourceWorkspaceId: 'ws1', queriedWorkspaces: ['ws2'], entityCount: 5, timestamp: new Date() }],
  })),
  revokeFederatedWorkspace: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('crypto', () => ({ randomUUID: () => 'test-uuid-1234' }));

import routeModule from '../routes/federation';

function buildApp() {
  const app = new Hono();
  app.route('/federation', routeModule);
  return app;
}

describe('POST /federation/workspaces', () => {
  it('creates a federated relationship', async () => {
    const res = await buildApp().request('/federation/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1', 'x-user-id': 'u1' },
      body: JSON.stringify({ targetWorkspaceId: 'ws2', relationshipType: 'sibling' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe('rel1');
  });

  it('returns 400 for self-federation', async () => {
    const res = await buildApp().request('/federation/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ targetWorkspaceId: 'ws1', relationshipType: 'sibling' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid relationship type', async () => {
    const res = await buildApp().request('/federation/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetWorkspaceId: 'ws2', relationshipType: 'enemy' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts custom permissions', async () => {
    const res = await buildApp().request('/federation/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({
        targetWorkspaceId: 'ws3',
        relationshipType: 'partner',
        permissions: [{ entityTypePattern: 'contact', canRead: true, canWrite: false }],
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /federation/workspaces', () => {
  it('lists federated relationships', async () => {
    const res = await buildApp().request('/federation/workspaces', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe('DELETE /federation/workspaces/:targetWorkspaceId', () => {
  it('revokes a federated relationship', async () => {
    const res = await buildApp().request('/federation/workspaces/ws2', {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { revoked: boolean } };
    expect(body.data.revoked).toBe(true);
  });
});

describe('POST /federation/query', () => {
  it('queries across federated workspaces', async () => {
    const res = await buildApp().request('/federation/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'show contacts', targetWorkspaceIds: ['ws2'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entities: unknown[]; queryId: string } };
    expect(body.data.entities).toHaveLength(1);
    expect(body.data.queryId).toBeTruthy();
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/federation/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetWorkspaceIds: ['ws2'] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty targetWorkspaceIds', async () => {
    const res = await buildApp().request('/federation/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', targetWorkspaceIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('respects maxTokenBudget parameter', async () => {
    const res = await buildApp().request('/federation/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'get deals', targetWorkspaceIds: ['ws2'], maxTokenBudget: 500 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /federation/audit', () => {
  it('returns federation audit log', async () => {
    const res = await buildApp().request('/federation/audit', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ queryId: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.queryId).toBe('q1');
  });

  it('accepts limit parameter', async () => {
    const res = await buildApp().request('/federation/audit?limit=10', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });
});
