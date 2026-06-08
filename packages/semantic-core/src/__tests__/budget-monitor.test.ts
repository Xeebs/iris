import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mean,
  stdDev,
  zScore,
  utilizationToSeverity,
  alertThresholdsCrossed,
  BudgetMonitor,
  type BudgetUsageEvent,
} from '../budget-monitor.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('mean', () => {
  it('computes the average of values', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('works for single value', () => {
    expect(mean([42])).toBe(42);
  });
});

describe('stdDev', () => {
  it('returns 0 for a single value', () => {
    expect(stdDev([5])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(stdDev([])).toBe(0);
  });

  it('computes population std dev correctly', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0, 1);
  });
});

describe('zScore', () => {
  it('returns 0 when std dev is 0', () => {
    expect(zScore(5, [5, 5, 5])).toBe(0);
  });

  it('returns high positive z for a spike', () => {
    const normal = [100, 102, 99, 101, 100, 103, 98, 100];
    const z = zScore(200, normal);
    expect(z).toBeGreaterThan(2);
  });

  it('returns near-zero for a mean value', () => {
    const values = [10, 10, 10, 10, 10];
    expect(zScore(10, values)).toBe(0);
  });
});

describe('utilizationToSeverity', () => {
  it('returns critical at 100%+', () => {
    expect(utilizationToSeverity(100)).toBe('critical');
    expect(utilizationToSeverity(120)).toBe('critical');
  });

  it('returns warning between 75-99%', () => {
    expect(utilizationToSeverity(75)).toBe('warning');
    expect(utilizationToSeverity(90)).toBe('warning');
  });

  it('returns info below 75%', () => {
    expect(utilizationToSeverity(0)).toBe('info');
    expect(utilizationToSeverity(74)).toBe('info');
  });
});

describe('alertThresholdsCrossed', () => {
  const thresholds = [75, 90, 100];

  it('returns empty when no threshold is crossed', () => {
    expect(alertThresholdsCrossed(50, 60, thresholds)).toHaveLength(0);
  });

  it('returns the crossed threshold', () => {
    const crossed = alertThresholdsCrossed(70, 80, thresholds);
    expect(crossed).toContain(75);
    expect(crossed).not.toContain(90);
  });

  it('returns multiple thresholds if multiple are crossed', () => {
    const crossed = alertThresholdsCrossed(60, 95, thresholds);
    expect(crossed).toContain(75);
    expect(crossed).toContain(90);
    expect(crossed).not.toContain(100);
  });

  it('returns all thresholds crossed in a big jump', () => {
    const crossed = alertThresholdsCrossed(0, 100, thresholds);
    expect(crossed).toHaveLength(3);
  });
});

// ─── BudgetMonitor class ──────────────────────────────────────────────────────

function makeSql(returnVal: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnVal);
}

const mockEvent: BudgetUsageEvent = {
  workspaceId: 'ws1',
  queryId: 'q1',
  tokensConsumed: 800,
  contextSize: 2000,
  provider: 'gpt-4o-mini',
  timestamp: new Date('2026-01-15'),
};

describe('BudgetMonitor', () => {
  let sql: ReturnType<typeof makeSql>;
  let monitor: BudgetMonitor;

  beforeEach(() => {
    sql = makeSql();
    monitor = new BudgetMonitor(sql as never);
    vi.clearAllMocks();
    sql.mockResolvedValue([]);
  });

  describe('trackQueryBudget', () => {
    it('inserts event and returns ok', async () => {
      const result = await monitor.trackQueryBudget(mockEvent);
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('insert failed'));
      const result = await monitor.trackQueryBudget(mockEvent);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('computeBudgetUtilization', () => {
    it('returns utilization with correct percentage', async () => {
      sql
        .mockResolvedValueOnce([{ monthly_token_budget: 1_000_000, rolling_window_days: 30 }])
        .mockResolvedValueOnce([{ total_tokens: 750_000 }]);

      const result = await monitor.computeBudgetUtilization('ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value.utilizationPct).toBe(75);
      expect(result.value.remainingTokens).toBe(250_000);
    });

    it('defaults to 1M budget when no workspace config found', async () => {
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total_tokens: 500_000 }]);

      const result = await monitor.computeBudgetUtilization('ws-new');
      expect(result.isOk()).toBe(true);
      expect(result.value.monthlyBudget).toBe(1_000_000);
      expect(result.value.utilizationPct).toBe(50);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('query failed'));
      const result = await monitor.computeBudgetUtilization('ws1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('detectBudgetAnomalies', () => {
    it('returns empty when fewer than 3 data points', async () => {
      sql.mockResolvedValue([
        { day: '2026-01-14', daily_tokens: 1000 },
        { day: '2026-01-15', daily_tokens: 1100 },
      ]);
      const result = await monitor.detectBudgetAnomalies('ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(0);
    });

    it('detects spike anomaly when z > 2.5', async () => {
      const normalDays = Array.from({ length: 20 }, (_, i) => ({
        day: `2026-01-${String(i + 1).padStart(2, '0')}`,
        daily_tokens: 1000 + Math.floor(Math.random() * 50),
      }));
      normalDays.push({ day: '2026-01-21', daily_tokens: 10000 });
      sql.mockResolvedValue(normalDays);

      const result = await monitor.detectBudgetAnomalies('ws1');
      expect(result.isOk()).toBe(true);
      const spike = result.value.find((a) => a.type === 'spike');
      expect(spike).toBeDefined();
      expect(spike!.zScore).toBeGreaterThan(2.5);
    });

    it('detects sustained_high when recent average exceeds historic by 50%', async () => {
      const rows = [
        ...Array.from({ length: 20 }, (_, i) => ({ day: `2026-01-${i + 1}`, daily_tokens: 1000 })),
        ...Array.from({ length: 7 }, (_, i) => ({ day: `2026-01-${i + 21}`, daily_tokens: 2000 })),
      ];
      sql.mockResolvedValue(rows);

      const result = await monitor.detectBudgetAnomalies('ws1');
      expect(result.isOk()).toBe(true);
      const sustained = result.value.find((a) => a.type === 'sustained_high');
      expect(sustained).toBeDefined();
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('query failed'));
      const result = await monitor.detectBudgetAnomalies('ws1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('suggestBudgetAdjustments', () => {
    it('recommends budget based on 7-day average + 20% headroom', async () => {
      sql.mockResolvedValue([{ current_budget: 500_000, avg_daily_tokens: 20_000 }]);

      const result = await monitor.suggestBudgetAdjustments('ws1');
      expect(result.isOk()).toBe(true);
      const expected = Math.ceil(20_000 * 30 * 1.2);
      expect(result.value.recommendedBudget).toBe(expected);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('query failed'));
      const result = await monitor.suggestBudgetAdjustments('ws1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('emitBudgetAlert', () => {
    it('inserts alert and returns warning severity at 90%', async () => {
      const result = await monitor.emitBudgetAlert('ws1', 90, ['email', 'slack']);
      expect(result.isOk()).toBe(true);
      expect(result.value.severity).toBe('warning');
      expect(result.value.thresholdPct).toBe(90);
      expect(result.value.notificationChannels).toContain('slack');
    });

    it('returns critical severity at 100%', async () => {
      const result = await monitor.emitBudgetAlert('ws1', 100, ['email']);
      expect(result.isOk()).toBe(true);
      expect(result.value.severity).toBe('critical');
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('insert failed'));
      const result = await monitor.emitBudgetAlert('ws1', 75, ['email']);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getActiveAlerts', () => {
    it('returns parsed alerts from DB', async () => {
      sql.mockResolvedValue([
        {
          threshold_pct: 90,
          triggered_at: '2026-01-15T10:00:00Z',
          acknowledged_at: null,
          notification_channels_used: '["email","slack"]',
        },
      ]);

      const result = await monitor.getActiveAlerts('ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.severity).toBe('warning');
      expect(result.value[0]!.notificationChannels).toContain('slack');
    });

    it('returns empty array when no alerts', async () => {
      sql.mockResolvedValue([]);
      const result = await monitor.getActiveAlerts('ws1');
      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(0);
    });

    it('returns err on DB failure', async () => {
      sql.mockRejectedValue(new Error('query failed'));
      const result = await monitor.getActiveAlerts('ws1');
      expect(result.isErr()).toBe(true);
    });
  });
});
