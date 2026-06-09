import { describe, it, expect, vi } from 'vitest';
import {
  tokensToUsd,
  periodToDays,
  estimateForecastConfidence,
  forecastTokens,
  CostAttributor,
} from '../cost-attribution.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── tokensToUsd ──────────────────────────────────────────────────────────────

describe('tokensToUsd', () => {
  it('returns 0 for 0 tokens', () => {
    expect(tokensToUsd(0)).toBe(0);
  });

  it('returns $0.02 for 1M tokens', () => {
    expect(tokensToUsd(1_000_000)).toBeCloseTo(0.02);
  });

  it('returns $0.002 for 100K tokens', () => {
    expect(tokensToUsd(100_000)).toBeCloseTo(0.002);
  });

  it('is proportional to token count', () => {
    expect(tokensToUsd(2_000_000)).toBeCloseTo(tokensToUsd(1_000_000) * 2);
  });
});

// ─── periodToDays ─────────────────────────────────────────────────────────────

describe('periodToDays', () => {
  it('returns 1 for day', () => { expect(periodToDays('day')).toBe(1); });
  it('returns 7 for week', () => { expect(periodToDays('week')).toBe(7); });
  it('returns 30 for month', () => { expect(periodToDays('month')).toBe(30); });
});

// ─── estimateForecastConfidence ───────────────────────────────────────────────

describe('estimateForecastConfidence', () => {
  it('returns low for 0 samples', () => {
    expect(estimateForecastConfidence(0)).toBe('low');
  });

  it('returns low for 4 samples', () => {
    expect(estimateForecastConfidence(4)).toBe('low');
  });

  it('returns medium for 5-13 samples', () => {
    expect(estimateForecastConfidence(5)).toBe('medium');
    expect(estimateForecastConfidence(13)).toBe('medium');
  });

  it('returns high for 14+ samples', () => {
    expect(estimateForecastConfidence(14)).toBe('high');
    expect(estimateForecastConfidence(30)).toBe('high');
  });
});

// ─── forecastTokens ───────────────────────────────────────────────────────────

describe('forecastTokens', () => {
  it('returns 0 for 0 daily avg', () => {
    expect(forecastTokens(0, 7)).toBe(0);
  });

  it('multiplies daily avg by days', () => {
    expect(forecastTokens(1000, 7)).toBe(7000);
    expect(forecastTokens(500, 30)).toBe(15000);
  });

  it('rounds to integer', () => {
    const result = forecastTokens(333.33, 3);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ─── CostAttributor ───────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('CostAttributor.attributeCostToEntity', () => {
  it('returns ok on success', async () => {
    const svc = new CostAttributor(makeSql([]));
    const r = await svc.attributeCostToEntity('q1', 'e1', 500, 120);
    expect(r.isOk()).toBe(true);
  });
});

describe('CostAttributor.getEntityCostBreakdown', () => {
  it('returns breakdown with estimated cost', async () => {
    const sql = makeSql([{ total_tokens: 10000, total_compute_ms: 500, query_count: 5 }]);
    const svc = new CostAttributor(sql);
    const r = await svc.getEntityCostBreakdown('e1');
    expect(r.isOk()).toBe(true);
    const b = r._unsafeUnwrap();
    expect(b.totalTokens).toBe(10000);
    expect(b.queryCount).toBe(5);
    expect(b.estimatedCostUsd).toBeCloseTo(tokensToUsd(10000));
  });

  it('returns zeros when no cost data', async () => {
    const sql = makeSql([{ total_tokens: null, total_compute_ms: null, query_count: null }]);
    const svc = new CostAttributor(sql);
    const r = await svc.getEntityCostBreakdown('e1');
    expect(r._unsafeUnwrap().totalTokens).toBe(0);
  });
});

describe('CostAttributor.computeConnectorCost', () => {
  it('returns connector cost summary', async () => {
    const sql = makeSql([{ api_call_count: 100, tokens_indexed: 50000, tokens_retrieved: 20000 }]);
    const svc = new CostAttributor(sql);
    const r = await svc.computeConnectorCost('hubspot', 'week');
    expect(r.isOk()).toBe(true);
    const s = r._unsafeUnwrap();
    expect(s.connectorId).toBe('hubspot');
    expect(s.period).toBe('week');
    expect(s.estimatedCostUsd).toBeCloseTo(tokensToUsd(70000));
  });
});

describe('CostAttributor.aggregateUserCosts', () => {
  it('returns user cost ledger with per-connector breakdown', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ query_count: 20, total_tokens: 40000 }])
      .mockResolvedValueOnce([{ connector_id: 'hubspot', tokens: 30000 }, { connector_id: 'salesforce', tokens: 10000 }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new CostAttributor(sql);
    const r = await svc.aggregateUserCosts('user1', 'month');
    expect(r.isOk()).toBe(true);
    const l = r._unsafeUnwrap();
    expect(l.queryCount).toBe(20);
    expect(l.totalTokens).toBe(40000);
    expect(l.byConnector).toHaveLength(2);
    expect(l.byConnector[0]!.connectorId).toBe('hubspot');
  });
});

describe('CostAttributor.computeCostForecast', () => {
  it('returns low confidence for sparse data', async () => {
    const sql = makeSql([{ day: '2026-06-01', daily_tokens: 1000 }]);
    const svc = new CostAttributor(sql);
    const r = await svc.computeCostForecast('e1', 'week');
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().confidenceLevel).toBe('low');
    expect(r._unsafeUnwrap().basedOnDays).toBe(1);
  });

  it('returns high confidence for rich history', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ day: `2026-05-${(i + 1).toString().padStart(2, '0')}`, daily_tokens: 2000 }));
    const svc = new CostAttributor(makeSql(rows));
    const r = await svc.computeCostForecast('e1', 'month');
    expect(r._unsafeUnwrap().confidenceLevel).toBe('high');
  });

  it('forecasts zero tokens for entity with no history', async () => {
    const svc = new CostAttributor(makeSql([]));
    const r = await svc.computeCostForecast('unknown', 'day');
    expect(r._unsafeUnwrap().forecastedTokens).toBe(0);
    expect(r._unsafeUnwrap().forecastedCostUsd).toBe(0);
  });
});
