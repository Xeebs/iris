import { describe, it, expect, vi } from 'vitest';
import {
  ConnectorHealthScorer,
  computeHealthScore,
  isDegraded,
  buildRecoveryRecommendations,
  type HealthScoreBreakdown,
} from '../connector-health-scorer.js';

function makeSql(responseMap: unknown[][] = []) {
  let idx = 0;
  return vi.fn(async () => responseMap[idx++] ?? []);
}

const perfectBreakdown: HealthScoreBreakdown = {
  connectorId: 'c-1', workspaceId: 'ws-1',
  overallScore: 100, syncSuccessRate: 1, entityFreshness: 1,
  errorFrequency: 1, authValidity: 1, scoredAt: new Date(),
};

describe('computeHealthScore', () => {
  it('returns 100 for all perfect sub-scores', () => {
    expect(computeHealthScore(1, 1, 1, 1)).toBe(100);
  });

  it('returns 0 for all zero sub-scores', () => {
    expect(computeHealthScore(0, 0, 0, 0)).toBe(0);
  });

  it('weights sync success at 40%', () => {
    expect(computeHealthScore(1, 0, 0, 0)).toBe(40);
  });

  it('weights entity freshness at 30%', () => {
    expect(computeHealthScore(0, 1, 0, 0)).toBe(30);
  });

  it('weights error frequency at 20%', () => {
    expect(computeHealthScore(0, 0, 1, 0)).toBe(20);
  });

  it('weights auth validity at 10%', () => {
    expect(computeHealthScore(0, 0, 0, 1)).toBe(10);
  });

  it('clamps output to 0–100', () => {
    expect(computeHealthScore(2, 2, 2, 2)).toBe(100);
    expect(computeHealthScore(-1, -1, -1, -1)).toBe(0);
  });
});

describe('isDegraded', () => {
  it('detects >15 point drop as degradation', () => {
    expect(isDegraded(70, 90)).toBe(true);
  });

  it('does not flag small drops as degradation', () => {
    expect(isDegraded(85, 90)).toBe(false);
  });

  it('does not flag exactly 15 point drop', () => {
    expect(isDegraded(75, 90)).toBe(false);
  });
});

describe('buildRecoveryRecommendations', () => {
  it('recommends re-auth when authValidity is low', () => {
    const breakdown = { ...perfectBreakdown, authValidity: 0.3, overallScore: 50 };
    const recs = buildRecoveryRecommendations(breakdown);
    expect(recs.some(r => r.actionType === 're-auth')).toBe(true);
  });

  it('recommends retry when syncSuccessRate is low', () => {
    const breakdown = { ...perfectBreakdown, syncSuccessRate: 0.4, overallScore: 50 };
    const recs = buildRecoveryRecommendations(breakdown);
    expect(recs.some(r => r.actionType === 'retry')).toBe(true);
  });

  it('recommends manual-sync when entityFreshness is low', () => {
    const breakdown = { ...perfectBreakdown, entityFreshness: 0.3, overallScore: 60 };
    const recs = buildRecoveryRecommendations(breakdown);
    expect(recs.some(r => r.actionType === 'manual-sync')).toBe(true);
  });

  it('recommends pause when errorFrequency is very low', () => {
    const breakdown = { ...perfectBreakdown, errorFrequency: 0.2, overallScore: 60 };
    const recs = buildRecoveryRecommendations(breakdown);
    expect(recs.some(r => r.actionType === 'pause')).toBe(true);
  });

  it('returns no recommendations for healthy connector', () => {
    const recs = buildRecoveryRecommendations(perfectBreakdown);
    expect(recs).toHaveLength(0);
  });

  it('orders recommendations by priority descending', () => {
    const breakdown = { ...perfectBreakdown, authValidity: 0.3, syncSuccessRate: 0.4, overallScore: 30 };
    const recs = buildRecoveryRecommendations(breakdown);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.priority).toBeGreaterThanOrEqual(recs[i]!.priority);
    }
  });
});

describe('ConnectorHealthScorer', () => {
  describe('scoreConnector', () => {
    it('computes and persists health score', async () => {
      const metricRow = { sync_success_rate: '0.9', entity_freshness: '0.8', error_frequency_score: '0.7', auth_validity: '1' };
      const sql = makeSql([[metricRow], []]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.scoreConnector('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      const b = result._unsafeUnwrap();
      expect(b.overallScore).toBe(computeHealthScore(0.9, 0.8, 0.7, 1));
    });

    it('returns error on DB failure', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.scoreConnector('c-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });

    it('handles missing sync history gracefully with defaults', async () => {
      const sql = makeSql([[], []]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.scoreConnector('new-c', 'ws-1');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('detectDegradation', () => {
    it('returns null when fewer than 2 score records exist', async () => {
      const sql = makeSql([[{ overall_score: 80, scored_at: new Date() }]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.detectDegradation('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('creates warning alert on moderate degradation', async () => {
      const now = new Date();
      const historyRows = [
        { overall_score: 60, scored_at: now },
        { overall_score: 80, scored_at: new Date(now.getTime() - 86400000) },
        { overall_score: 82, scored_at: new Date(now.getTime() - 172800000) },
      ];
      const alertRow = {
        alert_id: 'a-1', connector_id: 'c-1', workspace_id: 'ws-1',
        alert_type: 'degradation', severity: 'warning',
        message: 'Health score dropped', current_score: 60, baseline_score: 81,
        created_at: now, resolved_at: null,
      };
      const sql = makeSql([historyRows, [alertRow]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.detectDegradation('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      const alert = result._unsafeUnwrap();
      expect(alert).not.toBeNull();
      expect(alert?.alertType).toBe('degradation');
    });

    it('returns null when score is stable', async () => {
      const now = new Date();
      const sql = makeSql([[
        { overall_score: 85, scored_at: now },
        { overall_score: 88, scored_at: new Date(now.getTime() - 86400000) },
      ]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.detectDegradation('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('suggestRecovery', () => {
    it('returns empty list when no score data', async () => {
      const sql = makeSql([[]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.suggestRecovery('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns re-auth for low auth validity', async () => {
      const sql = makeSql([[{ overall_score: 45, sync_success_rate: 0.8, entity_freshness: 0.7, error_frequency: 0.7, auth_validity: 0.2, scored_at: new Date() }]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.suggestRecovery('c-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]?.actionType).toBe('re-auth');
    });
  });

  describe('executeRecoveryAction', () => {
    it('records action and returns result', async () => {
      const row = { action_id: 'act-1', connector_id: 'c-1', workspace_id: 'ws-1', action_type: 'retry', reason: 'Manual retry', executed_at: new Date(), result: 'initiated' };
      const sql = makeSql([[row]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.executeRecoveryAction('c-1', 'ws-1', 'retry');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().actionType).toBe('retry');
    });
  });

  describe('listActiveAlerts', () => {
    it('returns active alerts for workspace', async () => {
      const alert = { alert_id: 'a-1', connector_id: 'c-1', workspace_id: 'ws-1', alert_type: 'degradation', severity: 'warning', message: 'Degraded', current_score: 60, baseline_score: 80, created_at: new Date(), resolved_at: null };
      const sql = makeSql([[alert]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.listActiveAlerts('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });
  });

  describe('resolveAlert', () => {
    it('resolves alert without error', async () => {
      const sql = makeSql([[]]);
      const scorer = new ConnectorHealthScorer(sql as unknown as Parameters<typeof ConnectorHealthScorer>[0]);
      const result = await scorer.resolveAlert('a-1', 'ws-1');
      expect(result.isOk()).toBe(true);
    });
  });
});
