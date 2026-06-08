import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeHealthScore,
  scoreToSeverity,
  suggestRecoveryAction,
  inferFailureType,
  ConnectorHealthMonitor,
} from '../connector-health-monitor.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure functions ───────────────────────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns 100 for perfect metrics', () => {
    expect(computeHealthScore(100, 1000, 0, 0)).toBe(100);
  });

  it('returns 0 or near 0 for catastrophic metrics', () => {
    const score = computeHealthScore(0, 120_000, 100, 100);
    expect(score).toBeLessThan(20);
  });

  it('penalizes high latency proportionally', () => {
    const normalScore = computeHealthScore(100, 5_000, 0, 0);
    const slowScore = computeHealthScore(100, 60_000, 0, 0);
    expect(normalScore).toBeGreaterThan(slowScore);
  });

  it('penalizes high error rate', () => {
    const cleanScore = computeHealthScore(100, 1000, 0, 0);
    const dirtyScore = computeHealthScore(100, 1000, 15, 0);
    expect(cleanScore).toBeGreaterThan(dirtyScore);
  });

  it('penalizes high throttle rate', () => {
    const cleanScore = computeHealthScore(100, 1000, 0, 0);
    const throttledScore = computeHealthScore(100, 1000, 0, 30);
    expect(cleanScore).toBeGreaterThan(throttledScore);
  });

  it('returns value in 0-100 range', () => {
    const score = computeHealthScore(72, 15000, 3, 8);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('scoreToSeverity', () => {
  it('returns "critical" for score < 50', () => {
    expect(scoreToSeverity(30)).toBe('critical');
    expect(scoreToSeverity(49)).toBe('critical');
  });

  it('returns "warning" for score 50-79', () => {
    expect(scoreToSeverity(50)).toBe('warning');
    expect(scoreToSeverity(79)).toBe('warning');
  });

  it('returns "info" for score >= 80', () => {
    expect(scoreToSeverity(80)).toBe('info');
    expect(scoreToSeverity(100)).toBe('info');
  });
});

describe('suggestRecoveryAction', () => {
  it('suggests retry_sync for high_error_rate', () => {
    expect(suggestRecoveryAction('high_error_rate')).toBe('retry_sync');
  });

  it('suggests rotate_credentials for auth_failure', () => {
    expect(suggestRecoveryAction('auth_failure')).toBe('rotate_credentials');
  });

  it('suggests check_rate_limits for rate_limited', () => {
    expect(suggestRecoveryAction('rate_limited')).toBe('check_rate_limits');
  });

  it('suggests update_schema for schema_drift', () => {
    expect(suggestRecoveryAction('schema_drift')).toBe('update_schema');
  });

  it('suggests verify_permissions for no_data', () => {
    expect(suggestRecoveryAction('no_data')).toBe('verify_permissions');
  });

  it('suggests increase_timeout for high_latency', () => {
    expect(suggestRecoveryAction('high_latency')).toBe('increase_timeout');
  });

  it('suggests reduce_batch_size for low_success_rate', () => {
    expect(suggestRecoveryAction('low_success_rate')).toBe('reduce_batch_size');
  });
});

describe('inferFailureType', () => {
  it('returns no_data when total is zero', () => {
    expect(inferFailureType({ connectorId: 'c1', workspaceId: 'ws1', syncDurationMs: 1000, recordCount: 0, errorCount: 0, throttledRequests: 0 })).toBe('no_data');
  });

  it('returns high_error_rate when error rate is high', () => {
    expect(inferFailureType({ connectorId: 'c1', workspaceId: 'ws1', syncDurationMs: 1000, recordCount: 90, errorCount: 10, throttledRequests: 0 })).toBe('high_error_rate');
  });

  it('returns high_latency when sync is slow', () => {
    expect(inferFailureType({ connectorId: 'c1', workspaceId: 'ws1', syncDurationMs: 60_000, recordCount: 100, errorCount: 0, throttledRequests: 0 })).toBe('high_latency');
  });

  it('returns rate_limited when throttle rate is high', () => {
    expect(inferFailureType({ connectorId: 'c1', workspaceId: 'ws1', syncDurationMs: 5000, recordCount: 70, errorCount: 0, throttledRequests: 30 })).toBe('rate_limited');
  });

  it('returns null for healthy metrics', () => {
    expect(inferFailureType({ connectorId: 'c1', workspaceId: 'ws1', syncDurationMs: 2000, recordCount: 100, errorCount: 0, throttledRequests: 1 })).toBeNull();
  });
});

// ─── ConnectorHealthMonitor ───────────────────────────────────────────────────

describe('ConnectorHealthMonitor', () => {
  let sql: ReturnType<typeof vi.fn>;
  let monitor: ConnectorHealthMonitor;

  beforeEach(() => {
    sql = vi.fn();
    monitor = new ConnectorHealthMonitor(sql as never);
    vi.clearAllMocks();
  });

  describe('trackSyncMetrics', () => {
    it('inserts/upserts health score and returns it', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.trackSyncMetrics({
        connectorId: 'hubspot', workspaceId: 'ws1',
        syncDurationMs: 5000, recordCount: 100, errorCount: 0, throttledRequests: 0,
      });

      expect(result.isOk()).toBe(true);
      expect(result.value.connectorId).toBe('hubspot');
      expect(result.value.score).toBeGreaterThan(0);
      expect(sql).toHaveBeenCalled();
    });

    it('computes lower score for high error rate', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.trackSyncMetrics({
        connectorId: 'hubspot', workspaceId: 'ws1',
        syncDurationMs: 5000, recordCount: 80, errorCount: 20, throttledRequests: 0,
      });

      expect(result.isOk()).toBe(true);
      expect(result.value.score).toBeLessThan(90);
    });

    it('returns err on database failure', async () => {
      sql.mockRejectedValue(new Error('db error'));
      const result = await monitor.trackSyncMetrics({
        connectorId: 'hubspot', workspaceId: 'ws1',
        syncDurationMs: 1000, recordCount: 50, errorCount: 0, throttledRequests: 0,
      });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('detectUnhealthyState', () => {
    it('returns unhealthy false when no score exists', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.detectUnhealthyState('hubspot', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.unhealthy).toBe(false);
    });

    it('detects unhealthy state from low success rate', async () => {
      sql.mockResolvedValue([{
        score: 40,
        last_sync_success_rate: 80,
        last_sync_latency_ms: 5000,
        last_error_rate: 20,
        last_throttle_rate: 0,
      }]);
      const result = await monitor.detectUnhealthyState('hubspot', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.unhealthy).toBe(true);
      expect(result.value.reasons.length).toBeGreaterThan(0);
    });

    it('detects unhealthy state from high latency', async () => {
      sql.mockResolvedValue([{
        score: 60,
        last_sync_success_rate: 99,
        last_sync_latency_ms: 60_000,
        last_error_rate: 1,
        last_throttle_rate: 0,
      }]);
      const result = await monitor.detectUnhealthyState('hubspot', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.unhealthy).toBe(true);
      expect(result.value.reasons[0]).toContain('Latency');
    });

    it('returns healthy when metrics are within thresholds', async () => {
      sql.mockResolvedValue([{
        score: 95,
        last_sync_success_rate: 99,
        last_sync_latency_ms: 2000,
        last_error_rate: 0.5,
        last_throttle_rate: 1,
      }]);
      const result = await monitor.detectUnhealthyState('hubspot', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.unhealthy).toBe(false);
    });
  });

  describe('suggestRecovery', () => {
    it('delegates to suggestRecoveryAction and returns action', () => {
      const action = monitor.suggestRecovery('hubspot', 'auth_failure');
      expect(action).toBe('rotate_credentials');
    });
  });

  describe('emitHealthAlert', () => {
    it('inserts alert and returns it', async () => {
      sql.mockResolvedValue([{ id: 'alert-1', created_at: new Date().toISOString() }]);
      const result = await monitor.emitHealthAlert('hubspot', 'ws1', 'warning', 'high_error_rate');
      expect(result.isOk()).toBe(true);
      expect(result.value.id).toBe('alert-1');
      expect(result.value.severity).toBe('warning');
      expect(result.value.failureType).toBe('high_error_rate');
      expect(result.value.suggestedAction).toBe('retry_sync');
    });

    it('returns err on database failure', async () => {
      sql.mockRejectedValue(new Error('insert failed'));
      const result = await monitor.emitHealthAlert('hubspot', 'ws1', 'critical', 'no_data');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getHealthScore', () => {
    it('returns null score and empty alerts when connector not found', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.getHealthScore('unknown', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.score).toBeNull();
      expect(result.value.alerts).toHaveLength(0);
    });

    it('returns score and active alerts', async () => {
      sql
        .mockResolvedValueOnce([{
          connector_id: 'hubspot',
          workspace_id: 'ws1',
          score: 72,
          last_sync_success_rate: 93,
          last_sync_latency_ms: 8000,
          last_error_rate: 7,
          last_throttle_rate: 5,
          last_checked_at: new Date().toISOString(),
        }])
        .mockResolvedValueOnce([{
          id: 'alert-2',
          connector_id: 'hubspot',
          workspace_id: 'ws1',
          severity: 'warning',
          failure_type: 'high_error_rate',
          suggested_action: 'retry_sync',
          acknowledged_at: null,
          created_at: new Date().toISOString(),
        }]);

      const result = await monitor.getHealthScore('hubspot', 'ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.score?.score).toBe(72);
      expect(result.value.alerts).toHaveLength(1);
      expect(result.value.alerts[0]!.failureType).toBe('high_error_rate');
    });
  });

  describe('acknowledgeAlert', () => {
    it('issues UPDATE and returns ok', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.acknowledgeAlert('alert-1');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalled();
    });

    it('returns err on database failure', async () => {
      sql.mockRejectedValue(new Error('update failed'));
      const result = await monitor.acknowledgeAlert('alert-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
