import { describe, it, expect } from 'vitest';
import {
  computeChecksum,
  estimateSizeBytes,
  calculateRpo,
  estimateRtoMinutes,
  findRestoreChain,
} from '../backup-manager.js';
import type { BackupManifest } from '../backup-manager.js';

function makeManifest(overrides: Partial<BackupManifest>): BackupManifest {
  return {
    id: 'uuid-1',
    workspaceId: 'ws1',
    backupType: 'full',
    status: 'ready',
    entityCount: 100,
    sizeBytes: 204800,
    checksum: 'abc123',
    baseBackupId: null,
    sinceTimestamp: null,
    startedAt: new Date('2026-06-01T00:00:00Z'),
    completedAt: new Date('2026-06-01T00:05:00Z'),
    expiresAt: new Date('2026-07-01T00:00:00Z'),
    errorMessage: null,
    ...overrides,
  };
}

describe('computeChecksum', () => {
  it('returns a 64-char hex string', () => {
    const cs = computeChecksum('hello world');
    expect(cs).toHaveLength(64);
    expect(cs).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(computeChecksum('data')).toBe(computeChecksum('data'));
  });

  it('differs for different inputs', () => {
    expect(computeChecksum('a')).not.toBe(computeChecksum('b'));
  });
});

describe('estimateSizeBytes', () => {
  it('returns 0 for 0 entities', () => {
    expect(estimateSizeBytes(0)).toBe(0);
  });

  it('returns 2048 per entity', () => {
    expect(estimateSizeBytes(10)).toBe(20480);
  });
});

describe('calculateRpo', () => {
  it('returns Infinity when no backup exists', () => {
    expect(calculateRpo(null)).toBe(Infinity);
  });

  it('returns 0 for a backup completed just now', () => {
    const now = new Date();
    expect(calculateRpo(now, now)).toBe(0);
  });

  it('returns 1 for a backup completed 1 hour ago', () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3_600_000);
    expect(calculateRpo(oneHourAgo, now)).toBeCloseTo(1, 5);
  });

  it('returns 24 for a backup from yesterday', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3_600_000);
    expect(calculateRpo(yesterday, now)).toBeCloseTo(24, 3);
  });
});

describe('estimateRtoMinutes', () => {
  it('returns minimum 2 minutes for tiny backups', () => {
    expect(estimateRtoMinutes(0)).toBe(2);
    expect(estimateRtoMinutes(1024)).toBe(2);
  });

  it('returns proportional estimate for large backups', () => {
    const GB = 1024 * 1024 * 1024;
    expect(estimateRtoMinutes(GB)).toBe(3); // 1 GB/min + 2 overhead
    expect(estimateRtoMinutes(5 * GB)).toBe(7);
  });
});

describe('findRestoreChain', () => {
  const target = new Date('2026-06-02T12:00:00Z');

  const fullBackup = makeManifest({
    id: 'full-1',
    backupType: 'full',
    completedAt: new Date('2026-06-01T06:00:00Z'),
  });

  const inc1 = makeManifest({
    id: 'inc-1',
    backupType: 'incremental',
    baseBackupId: 'full-1',
    completedAt: new Date('2026-06-01T12:00:00Z'),
  });

  const inc2 = makeManifest({
    id: 'inc-2',
    backupType: 'incremental',
    baseBackupId: 'full-1',
    completedAt: new Date('2026-06-02T00:00:00Z'),
  });

  const futureInc = makeManifest({
    id: 'inc-future',
    backupType: 'incremental',
    baseBackupId: 'full-1',
    completedAt: new Date('2026-06-03T00:00:00Z'), // after target
  });

  it('returns empty array when no full backup exists before target', () => {
    const chain = findRestoreChain([inc1], target);
    expect(chain).toHaveLength(0);
  });

  it('returns just the full backup when no incrementals exist', () => {
    const chain = findRestoreChain([fullBackup], target);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.id).toBe('full-1');
  });

  it('includes incrementals in chronological order', () => {
    const chain = findRestoreChain([fullBackup, inc2, inc1], target);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.id).toBe('full-1');
    expect(chain[1]!.id).toBe('inc-1');
    expect(chain[2]!.id).toBe('inc-2');
  });

  it('excludes incrementals after target timestamp', () => {
    const chain = findRestoreChain([fullBackup, inc1, inc2, futureInc], target);
    expect(chain.map((m) => m.id)).not.toContain('inc-future');
  });

  it('excludes failed backups', () => {
    const failedFull = makeManifest({ id: 'full-failed', backupType: 'full', status: 'failed', completedAt: new Date('2026-06-01T06:00:00Z') });
    const chain = findRestoreChain([failedFull, inc1], target);
    expect(chain).toHaveLength(0);
  });
});
