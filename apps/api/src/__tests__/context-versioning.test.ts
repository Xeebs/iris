import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/context-versioner', () => ({
  captureContextSnapshot: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      snapshotId: 'snap-1',
      workspaceId: 'ws1',
      snapshotKey: 'test-snap',
      capturedAt: new Date('2026-06-08T10:00:00Z'),
      dataSizeBytes: 50000,
      gzipSizeBytes: 20000,
      entityCount: 120,
      checksum: 'abc123def456',
    },
  })),
  queryAsOfDate: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      entities: [{ id: 'e1', type: 'contact', label: 'Alice', attributes: {}, snapshotedAt: new Date() }],
      snapshotId: 'snap-1',
      queryTokensEstimate: 80,
      truncated: false,
    },
  })),
  diffContextVersions: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      workspaceId: 'ws1',
      fromVersionId: 'snap-1',
      toVersionId: 'snap-2',
      changedEntityIds: ['e1', 'e2', 'e3'],
      changeTypes: ['created', 'updated', 'deleted'],
      diffSummary: { created: 1, updated: 1, deleted: 1, totalChanges: 3 },
    },
  })),
  listVersionHistory: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      entries: [
        { snapshotId: 'snap-2', snapshotKey: 'v2', capturedAt: new Date(), entityCount: 130, dataSizeBytes: 55000 },
        { snapshotId: 'snap-1', snapshotKey: 'v1', capturedAt: new Date(), entityCount: 120, dataSizeBytes: 50000 },
      ],
      nextCursor: null,
      hasMore: false,
    },
  })),
  rollbackToVersion: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: { rolledBackTo: new Date('2026-06-01T00:00:00Z'), entityCount: 120 },
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/context-versioning';

function buildApp() {
  const app = new Hono();
  app.route('/context', routeModule);
  return app;
}

describe('POST /context/snapshots', () => {
  it('captures a snapshot and returns 201', async () => {
    const res = await buildApp().request('/context/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ snapshotKey: 'before-migration' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { snapshotId: string; entityCount: number } };
    expect(body.data.snapshotId).toBe('snap-1');
    expect(body.data.entityCount).toBe(120);
  });

  it('uses default snapshotKey when not provided', async () => {
    const res = await buildApp().request('/context/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /context/snapshots', () => {
  it('lists version history', async () => {
    const res = await buildApp().request('/context/snapshots', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.hasMore).toBe(false);
  });

  it('accepts limit and cursor parameters', async () => {
    const res = await buildApp().request('/context/snapshots?limit=10&cursor=snap-1', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /context/query-as-of', () => {
  it('returns historical query results', async () => {
    const res = await buildApp().request('/context/query-as-of', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'show contacts', targetDate: '2026-06-01T00:00:00Z' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entities: unknown[]; snapshotId: string } };
    expect(body.data.entities).toHaveLength(1);
    expect(body.data.snapshotId).toBe('snap-1');
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/context/query-as-of', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-06-01T00:00:00Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await buildApp().request('/context/query-as-of', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show contacts', targetDate: 'not-a-date' }),
    });
    expect(res.status).toBe(400);
  });

  it('respects contextBudget parameter', async () => {
    const res = await buildApp().request('/context/query-as-of', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ query: 'contacts', targetDate: '2026-06-01T00:00:00Z', contextBudget: 500 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /context/versions/:id/diff', () => {
  it('returns version diff', async () => {
    const res = await buildApp().request('/context/versions/snap-1/diff?toVersion=snap-2', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { diffSummary: { totalChanges: number } } };
    expect(body.data.diffSummary.totalChanges).toBe(3);
  });

  it('returns 400 when toVersion is missing', async () => {
    const res = await buildApp().request('/context/versions/snap-1/diff', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /context/rollback', () => {
  it('rolls back and returns rolledBackTo date', async () => {
    const res = await buildApp().request('/context/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1', 'x-user-id': 'admin' },
      body: JSON.stringify({ versionId: '550e8400-e29b-41d4-a716-446655440000', confirm: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entityCount: number } };
    expect(body.data.entityCount).toBe(120);
  });

  it('returns 400 when confirm is missing', async () => {
    const res = await buildApp().request('/context/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: '550e8400-e29b-41d4-a716-446655440000' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when versionId is not a valid UUID', async () => {
    const res = await buildApp().request('/context/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: 'not-a-uuid', confirm: true }),
    });
    expect(res.status).toBe(400);
  });
});
