import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHaAdminRouter } from '../routes/ha-admin.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/ha-manager', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/ha-manager')>(
    '@iris/semantic-core/ha-manager',
  );
  return { ...actual, HaManager: vi.fn() };
});

import { HaManager } from '@iris/semantic-core/ha-manager';

const mockManager = {
  getStatus: vi.fn(),
  listFailoverHistory: vi.fn(),
  recordFailover: vi.fn(),
  updateReplicationStatus: vi.fn(),
};

function makeApp() {
  (HaManager as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockManager);
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  return makeHaAdminRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-workspace-id': 'ws1', 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /ha/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns HA status', async () => {
    const { ok } = await import('neverthrow');
    mockManager.getStatus.mockResolvedValue(ok({ primaryRegion: null, replicaRegions: [], lastFailover: null, overallStatus: 'healthy' }));
    const app = makeApp();
    const res = await app.fetch(req('/status'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.overallStatus).toBe('healthy');
  });

  it('returns 500 on error', async () => {
    const { err } = await import('neverthrow');
    mockManager.getStatus.mockResolvedValue(err(new Error('db down')));
    const app = makeApp();
    const res = await app.fetch(req('/status'));
    expect(res.status).toBe(500);
  });
});

describe('POST /ha/failover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a manual failover', async () => {
    const { ok } = await import('neverthrow');
    const event = { id: 'ev-1', fromRegion: 'us-west-2', toRegion: 'us-east-1', reason: 'manual', lagAtFailoverMs: null, durationMs: null, initiatedBy: 'admin', occurredAt: new Date() };
    mockManager.recordFailover.mockResolvedValue(ok(event));
    const app = makeApp();
    const res = await app.fetch(req('/failover', {
      method: 'POST',
      body: JSON.stringify({ fromRegion: 'us-west-2', toRegion: 'us-east-1', confirmedBy: 'admin' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.fromRegion).toBe('us-west-2');
  });

  it('returns 400 on missing fields', async () => {
    const app = makeApp();
    const res = await app.fetch(req('/failover', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
});

describe('GET /ha/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns failover history', async () => {
    const { ok } = await import('neverthrow');
    mockManager.listFailoverHistory.mockResolvedValue(ok([]));
    const app = makeApp();
    const res = await app.fetch(req('/history'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe('POST /ha/replication-status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates replication status', async () => {
    const { ok } = await import('neverthrow');
    mockManager.updateReplicationStatus.mockResolvedValue(ok(undefined));
    const app = makeApp();
    const res = await app.fetch(req('/replication-status', {
      method: 'POST',
      body: JSON.stringify({ regionId: 'us-east-1', primaryRegionId: 'us-west-2', lagMs: 120, status: 'healthy' }),
    }));
    expect(res.status).toBe(200);
  });
});
