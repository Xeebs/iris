import { describe, it, expect } from 'vitest';
import { computeAttainment, computeSloStatus, suggestCorrectiveAction } from '../slo-monitor.js';

describe('computeAttainment', () => {
  it('returns 1 for empty events (no data = met)', () => {
    expect(computeAttainment([])).toBe(1);
  });

  it('returns 1 when all events are met', () => {
    const events = [{ met: true }, { met: true }, { met: true }];
    expect(computeAttainment(events)).toBe(1);
  });

  it('returns 0 when all events are not met', () => {
    const events = [{ met: false }, { met: false }];
    expect(computeAttainment(events)).toBe(0);
  });

  it('returns 0.75 for 3 met out of 4', () => {
    const events = [{ met: true }, { met: true }, { met: true }, { met: false }];
    expect(computeAttainment(events)).toBe(0.75);
  });

  it('returns 0.5 for equal met/unmet', () => {
    const events = [{ met: true }, { met: false }];
    expect(computeAttainment(events)).toBe(0.5);
  });

  it('computes fractional precision', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ met: i < 99 }));
    expect(computeAttainment(events)).toBe(0.99);
  });
});

describe('computeSloStatus', () => {
  it('returns ok when attainment meets target exactly', () => {
    expect(computeSloStatus(0.99, 0.99)).toBe('ok');
  });

  it('returns ok when attainment exceeds target', () => {
    expect(computeSloStatus(1.0, 0.99)).toBe('ok');
  });

  it('returns warning when attainment is 95–100% of target', () => {
    // target=0.99, 95% of that = 0.9405; attainment=0.96 is in [0.9405, 0.99)
    expect(computeSloStatus(0.96, 0.99)).toBe('warning');
  });

  it('returns breached when attainment is below 95% of target', () => {
    // target=0.99, 95% of that = 0.9405; attainment=0.9 < 0.9405
    expect(computeSloStatus(0.9, 0.99)).toBe('breached');
  });

  it('returns breached for very low attainment', () => {
    expect(computeSloStatus(0.5, 0.99)).toBe('breached');
  });

  it('returns ok for 100% target and 100% attainment', () => {
    expect(computeSloStatus(1.0, 1.0)).toBe('ok');
  });
});

describe('suggestCorrectiveAction', () => {
  it('suggests cache/vector action for latency metrics', () => {
    const hint = suggestCorrectiveAction('mcp_query_latency_p95_ms', 0.85);
    expect(hint.toLowerCase()).toMatch(/cache|vector|index/);
  });

  it('suggests reviewing slow queries for near-miss latency', () => {
    const hint = suggestCorrectiveAction('mcp_query_latency_p95_ms', 0.97);
    expect(hint.toLowerCase()).toContain('slow quer');
  });

  it('suggests API log check for availability metrics', () => {
    const hint = suggestCorrectiveAction('api_success_rate', 0.8);
    expect(hint.toLowerCase()).toContain('api');
  });

  it('suggests connector check for sync metrics', () => {
    const hint = suggestCorrectiveAction('sync_success_rate', 0.7);
    expect(hint.toLowerCase()).toMatch(/connector|circuit/);
  });

  it('suggests scheduler check for freshness metrics', () => {
    const hint = suggestCorrectiveAction('index_freshness_hours', 0.8);
    expect(hint.toLowerCase()).toMatch(/sync|scheduler/);
  });

  it('returns generic hint for unknown metrics', () => {
    const hint = suggestCorrectiveAction('unknown_metric_xyz', 0.5);
    expect(hint.length).toBeGreaterThan(0);
  });
});
