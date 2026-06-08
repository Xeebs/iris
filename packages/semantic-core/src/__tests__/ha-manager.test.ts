import { describe, it, expect } from 'vitest';
import {
  isLagExceeded,
  computeOverallStatus,
  selectPromotionCandidate,
  formatLag,
} from '../ha-manager.js';
import type { ReplicationStatus } from '../ha-manager.js';

function makeStatus(overrides: Partial<ReplicationStatus>): ReplicationStatus {
  return {
    regionId: 'us-east-1',
    primaryRegionId: 'us-west-2',
    lagMs: 50,
    lastSyncAt: new Date(),
    status: 'healthy',
    checkedAt: new Date(),
    ...overrides,
  };
}

describe('isLagExceeded', () => {
  it('returns false when lag is null (unknown)', () => {
    expect(isLagExceeded(null, 5000)).toBe(false);
  });

  it('returns false when lag is below threshold', () => {
    expect(isLagExceeded(1000, 5000)).toBe(false);
  });

  it('returns true when lag exceeds threshold', () => {
    expect(isLagExceeded(6000, 5000)).toBe(true);
  });

  it('returns false at exactly the threshold', () => {
    expect(isLagExceeded(5000, 5000)).toBe(false);
  });
});

describe('computeOverallStatus', () => {
  it('returns healthy with no replicas', () => {
    expect(computeOverallStatus([])).toBe('healthy');
  });

  it('returns healthy when all replicas are healthy', () => {
    const replicas = [makeStatus({ status: 'healthy' }), makeStatus({ regionId: 'eu-west-1', status: 'healthy' })];
    expect(computeOverallStatus(replicas)).toBe('healthy');
  });

  it('returns degraded when any replica is unreachable', () => {
    const replicas = [makeStatus({ status: 'healthy' }), makeStatus({ status: 'unreachable' })];
    expect(computeOverallStatus(replicas)).toBe('degraded');
  });

  it('returns degraded when all replicas are degraded', () => {
    const replicas = [makeStatus({ status: 'degraded' }), makeStatus({ status: 'degraded' })];
    expect(computeOverallStatus(replicas)).toBe('degraded');
  });

  it('returns healthy when some replicas are degraded but none unreachable', () => {
    const replicas = [makeStatus({ status: 'healthy' }), makeStatus({ status: 'degraded' })];
    expect(computeOverallStatus(replicas)).toBe('healthy');
  });
});

describe('selectPromotionCandidate', () => {
  it('returns null when no replicas available', () => {
    expect(selectPromotionCandidate([], 5000)).toBeNull();
  });

  it('returns null when all replicas exceed max lag', () => {
    const replicas = [makeStatus({ lagMs: 10000 })];
    expect(selectPromotionCandidate(replicas, 5000)).toBeNull();
  });

  it('returns null when all replicas unreachable', () => {
    const replicas = [makeStatus({ status: 'unreachable', lagMs: 100 })];
    expect(selectPromotionCandidate(replicas, 5000)).toBeNull();
  });

  it('selects the replica with lowest lag', () => {
    const replicas = [
      makeStatus({ regionId: 'us-east-1', lagMs: 300 }),
      makeStatus({ regionId: 'eu-west-1', lagMs: 50 }),
      makeStatus({ regionId: 'ap-south-1', lagMs: 200 }),
    ];
    const candidate = selectPromotionCandidate(replicas, 5000);
    expect(candidate!.regionId).toBe('eu-west-1');
  });

  it('prefers replica with null lag when within max', () => {
    const replicas = [
      makeStatus({ regionId: 'us-east-1', lagMs: 100 }),
      makeStatus({ regionId: 'eu-west-1', lagMs: null }),
    ];
    const candidate = selectPromotionCandidate(replicas, 5000);
    // null lag sorts as 0 (Infinity), so us-east-1 wins
    expect(candidate!.regionId).toBe('us-east-1');
  });
});

describe('formatLag', () => {
  it('returns "unknown" for null', () => {
    expect(formatLag(null)).toBe('unknown');
  });

  it('formats milliseconds', () => {
    expect(formatLag(450)).toBe('450ms');
  });

  it('formats seconds for >= 1000ms', () => {
    expect(formatLag(2500)).toBe('2.5s');
  });

  it('formats exactly 1000ms as seconds', () => {
    expect(formatLag(1000)).toBe('1.0s');
  });
});
