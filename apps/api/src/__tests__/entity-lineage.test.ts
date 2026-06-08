import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetLineage = vi.fn();
const mockListEntityLineage = vi.fn();
const mockRecordOrigin = vi.fn().mockResolvedValue(undefined);
const mockAddTransformation = vi.fn().mockResolvedValue(undefined);
const mockRecordOriginBatch = vi.fn().mockResolvedValue(undefined);

vi.mock('@iris/semantic-core/data-lineage', () => ({
  DataLineageService: vi.fn().mockImplementation(() => ({
    getLineage: mockGetLineage,
    listEntityLineage: mockListEntityLineage,
    recordOrigin: mockRecordOrigin,
    addTransformation: mockAddTransformation,
    recordOriginBatch: mockRecordOriginBatch,
  })),
}));

import { createEntityLineageRoutes } from '../routes/entity-lineage.js';

function makeApp(): Hono {
  const fakeSql = {} as Parameters<typeof createEntityLineageRoutes>[0];
  const app = new Hono();
  app.route('/entities', createEntityLineageRoutes(fakeSql));
  app.route('/lineage', createEntityLineageRoutes(fakeSql));
  return app;
}

const sampleRecord = {
  entityId: 'hubspot:contact:1',
  workspaceId: 'ws-1',
  sourceConnectorId: 'hubspot',
  sourceSyncJobId: 'job-abc',
  sourceApiTimestamp: new Date('2026-01-01T00:00:00Z'),
  transformations: [
    { type: 'embedding', timestamp: '2026-01-01T01:00:00.000Z', metadata: { model: 'text-embedding-3-small' } },
  ],
  lastModifiedBy: 'system',
  lastModifiedAt: new Date('2026-01-01T01:00:00Z'),
};

describe('GET /entities/:id/lineage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/entities/hubspot:contact:1/lineage');
    expect(res.status).toBe(400);
  });

  it('returns 200 with null data when no lineage exists', async () => {
    mockGetLineage.mockResolvedValue(null);
    const app = makeApp();
    const res = await app.request('/entities/hubspot:contact:unknown/lineage?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: null };
    expect(body.data).toBeNull();
  });

  it('returns 200 with lineage record', async () => {
    mockGetLineage.mockResolvedValue(sampleRecord);
    const app = makeApp();
    const res = await app.request('/entities/hubspot:contact:1/lineage?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof sampleRecord };
    expect(body.data.entityId).toBe('hubspot:contact:1');
    expect(body.data.sourceConnectorId).toBe('hubspot');
    expect(body.data.transformations).toHaveLength(1);
    expect(body.data.transformations[0]!.type).toBe('embedding');
  });

  it('passes entityId and workspaceId to service', async () => {
    mockGetLineage.mockResolvedValue(null);
    const app = makeApp();
    await app.request('/entities/my:entity:42/lineage?workspaceId=ws-x');
    expect(mockGetLineage).toHaveBeenCalledWith('my:entity:42', 'ws-x');
  });
});

describe('GET /lineage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/lineage');
    expect(res.status).toBe(400);
  });

  it('returns 200 with empty array when no records', async () => {
    mockListEntityLineage.mockResolvedValue([]);
    const app = makeApp();
    const res = await app.request('/lineage?workspaceId=ws-empty');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toEqual([]);
    expect(body.meta.hasMore).toBe(false);
  });

  it('returns records with pagination meta', async () => {
    const records = Array.from({ length: 2 }, (_, i) => ({
      ...sampleRecord,
      entityId: `entity-${i}`,
      lastModifiedAt: new Date(`2026-01-0${i + 1}`),
    }));
    mockListEntityLineage.mockResolvedValue(records);
    const app = makeApp();
    const res = await app.request('/lineage?workspaceId=ws-1&limit=2');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof records; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.hasMore).toBe(true);
  });

  it('includes nextCursor when results fill the page', async () => {
    const records = Array.from({ length: 50 }, (_, i) => ({
      ...sampleRecord,
      entityId: `entity-${i}`,
      lastModifiedAt: new Date(`2026-01-01T00:${String(i).padStart(2, '0')}:00Z`),
    }));
    mockListEntityLineage.mockResolvedValue(records);
    const app = makeApp();
    const res = await app.request('/lineage?workspaceId=ws-1&limit=50');
    const body = await res.json() as { meta: { hasMore: boolean; nextCursor?: string } };
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeDefined();
  });

  it('passes cursor to service when provided', async () => {
    mockListEntityLineage.mockResolvedValue([]);
    const app = makeApp();
    const cursor = '2026-01-01T00:00:00.000Z';
    await app.request(`/lineage?workspaceId=ws-1&cursor=${encodeURIComponent(cursor)}`);
    expect(mockListEntityLineage).toHaveBeenCalledWith('ws-1', 50, cursor);
  });

  it('returns 400 for invalid limit', async () => {
    const app = makeApp();
    const res = await app.request('/lineage?workspaceId=ws-1&limit=abc');
    expect(res.status).toBe(400);
  });
});
