import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBackupRecoveryRouter } from '../routes/backup-recovery.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/backup-manager', async () => {
  const actual = await vi.importActual<typeof import('@iris/semantic-core/backup-manager')>(
    '@iris/semantic-core/backup-manager',
  );
  return { ...actual, BackupManager: vi.fn() };
});

import { BackupManager } from '@iris/semantic-core/backup-manager';

const mockManager = {
  listBackups: vi.fn(),
  createFullBackup: vi.fn(),
  createIncrementalBackup: vi.fn(),
  validateBackupIntegrity: vi.fn(),
  pruneOldBackups: vi.fn(),
  getRtpRpoMetrics: vi.fn(),
};

const fakeBackup = {
  id: 'bk-1',
  workspaceId: 'ws1',
  backupType: 'full',
  status: 'ready',
  entityCount: 50,
  sizeBytes: 102400,
  checksum: 'abc',
  baseBackupId: null,
  sinceTimestamp: null,
  startedAt: new Date('2026-06-01T00:00:00Z'),
  completedAt: new Date('2026-06-01T00:01:00Z'),
  expiresAt: new Date('2026-07-01T00:00:00Z'),
  errorMessage: null,
};

function makeApp() {
  (BackupManager as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockManager);
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  return makeBackupRecoveryRouter(sql);
}

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-workspace-id': 'ws1', 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

describe('GET /backups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns backup list', async () => {
    const { ok } = await import('neverthrow');
    mockManager.listBackups.mockResolvedValue(ok([fakeBackup]));
    const app = makeApp();
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('bk-1');
  });

  it('returns 500 on list error', async () => {
    const { err } = await import('neverthrow');
    mockManager.listBackups.mockResolvedValue(err(new Error('db down')));
    const app = makeApp();
    const res = await app.fetch(req('/'));
    expect(res.status).toBe(500);
  });
});

describe('POST /backups/full', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a full backup', async () => {
    const { ok } = await import('neverthrow');
    mockManager.createFullBackup.mockResolvedValue(ok(fakeBackup));
    const app = makeApp();
    const res = await app.fetch(req('/full', { method: 'POST', body: JSON.stringify({ retentionDays: 7 }) }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('bk-1');
  });

  it('returns 500 on failure', async () => {
    const { err } = await import('neverthrow');
    mockManager.createFullBackup.mockResolvedValue(err(new Error('query failed')));
    const app = makeApp();
    const res = await app.fetch(req('/full', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(500);
  });
});

describe('POST /backups/incremental', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an incremental backup', async () => {
    const { ok } = await import('neverthrow');
    const incBackup = { ...fakeBackup, id: 'bk-2', backupType: 'incremental', baseBackupId: 'bk-1' };
    mockManager.createIncrementalBackup.mockResolvedValue(ok(incBackup));
    const app = makeApp();
    const res = await app.fetch(
      req('/incremental', {
        method: 'POST',
        body: JSON.stringify({ baseBackupId: 'bk-1', sinceTimestamp: '2026-06-01T00:00:00.000Z' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.backupType).toBe('incremental');
  });
});

describe('GET /backups/metrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns RTO/RPO metrics', async () => {
    const { ok } = await import('neverthrow');
    const metrics = {
      workspaceId: 'ws1',
      lastFullBackupAt: new Date(),
      lastIncrementalAt: null,
      lastBackupAt: new Date(),
      estimatedRpoHours: 0.5,
      estimatedRtoMinutes: 2,
      backupCount: { full: 1, incremental: 0 },
    };
    mockManager.getRtpRpoMetrics.mockResolvedValue(ok(metrics));
    const app = makeApp();
    const res = await app.fetch(req('/metrics'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.estimatedRtoMinutes).toBe(2);
  });
});
