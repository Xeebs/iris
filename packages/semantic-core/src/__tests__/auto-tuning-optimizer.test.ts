import { describe, it, expect, vi } from 'vitest';
import { AutoTuningOptimizer } from '../auto-tuning-optimizer.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

// ─── SQL mock helpers ─────────────────────────────────────────────────────────

function makeSql(...responses: unknown[][]) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

// ─── analyzeQueryPatterns ─────────────────────────────────────────────────────

describe('AutoTuningOptimizer.analyzeQueryPatterns', () => {
  it('returns query patterns with top queries and zero-result queries', async () => {
    const svc = new AutoTuningOptimizer(makeSql(
      [{ query_text: 'find contacts', count: '20' }],
      [{ query_text: 'obscure thing', count: '5' }],
      [{ entity_type: 'contact', query_count: '15', last_used: '2026-06-01' }],
      [{ avg_ms: '250' }],
      [],
    ));
    const result = await svc.analyzeQueryPatterns('ws-1');
    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.topQueries).toHaveLength(1);
    expect(data.topQueries[0]?.query).toBe('find contacts');
    expect(data.topQueries[0]?.count).toBe(20);
    expect(data.zeroResultQueries).toHaveLength(1);
    expect(data.avgQueryLatencyMs).toBe(250);
  });

  it('identifies unused entity types', async () => {
    const svc = new AutoTuningOptimizer(makeSql(
      [],
      [],
      [{ entity_type: 'contact', query_count: '5', last_used: null }],
      [{ avg_ms: '100' }],
      [{ entity_type: 'contact' }, { entity_type: 'deal' }, { entity_type: 'invoice' }],
    ));
    const result = await svc.analyzeQueryPatterns('ws-1');
    const data = result._unsafeUnwrap();
    expect(data.unusedEntityTypes).toContain('deal');
    expect(data.unusedEntityTypes).toContain('invoice');
    expect(data.unusedEntityTypes).not.toContain('contact');
  });

  it('identifies high-frequency entity types (>10 queries)', async () => {
    const svc = new AutoTuningOptimizer(makeSql(
      [],
      [],
      [
        { entity_type: 'contact', query_count: '50', last_used: null },
        { entity_type: 'deal', query_count: '3', last_used: null },
      ],
      [{ avg_ms: '200' }],
      [],
    ));
    const result = await svc.analyzeQueryPatterns('ws-1');
    const data = result._unsafeUnwrap();
    expect(data.highFrequencyEntityTypes).toContain('contact');
    expect(data.highFrequencyEntityTypes).not.toContain('deal');
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new AutoTuningOptimizer(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.analyzeQueryPatterns('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── listRecommendations ──────────────────────────────────────────────────────

describe('AutoTuningOptimizer.listRecommendations', () => {
  it('returns recommendation rows mapped from DB', async () => {
    const row = {
      id: 'rec-1',
      workspace_id: 'ws-1',
      type: 'enable_full_text',
      title: 'Enable full-text search',
      description: 'Reduces zero-result queries',
      estimated_monthly_savings_cents: '0',
      estimated_quality_impact_pct: '15',
      status: 'pending',
      ab_test_id: null,
      created_at: '2026-06-08T00:00:00Z',
    };
    const svc = new AutoTuningOptimizer(makeSql([row]));
    const result = await svc.listRecommendations('ws-1');
    expect(result.isOk()).toBe(true);
    const recs = result._unsafeUnwrap();
    expect(recs).toHaveLength(1);
    expect(recs[0]?.id).toBe('rec-1');
    expect(recs[0]?.estimatedQualityImpactPct).toBe(15);
    expect(recs[0]?.status).toBe('pending');
  });

  it('returns empty array when no recommendations', async () => {
    const svc = new AutoTuningOptimizer(makeSql([]));
    const result = await svc.listRecommendations('ws-1');
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('query failed'));
    const svc = new AutoTuningOptimizer(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.listRecommendations('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── activateAbTest ───────────────────────────────────────────────────────────

describe('AutoTuningOptimizer.activateAbTest', () => {
  it('creates A/B test and updates recommendation status', async () => {
    const recRow = {
      id: 'rec-1',
      workspace_id: 'ws-1',
      type: 'enable_full_text',
      title: 'title',
      description: 'desc',
      estimated_monthly_savings_cents: '0',
      estimated_quality_impact_pct: '0',
      status: 'pending',
      ab_test_id: null,
      created_at: '2026-06-08T00:00:00Z',
    };
    const testRow = {
      id: 'test-1',
      recommendation_id: 'rec-1',
      status: 'running',
      control_metric: '0',
      treatment_metric: '0',
      conclusion_at: null,
    };
    const svc = new AutoTuningOptimizer(makeSql([recRow], [testRow], []));
    const result = await svc.activateAbTest('ws-1', 'rec-1');
    expect(result.isOk()).toBe(true);
    const test = result._unsafeUnwrap();
    expect(test.testId).toBe('test-1');
    expect(test.status).toBe('running');
  });

  it('returns err when recommendation not found', async () => {
    const svc = new AutoTuningOptimizer(makeSql([]));
    const result = await svc.activateAbTest('ws-1', 'rec-missing');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });
});

// ─── recordFeedback ───────────────────────────────────────────────────────────

describe('AutoTuningOptimizer.recordFeedback', () => {
  it('returns ok on success', async () => {
    const svc = new AutoTuningOptimizer(makeSql([]));
    const result = await svc.recordFeedback('ws-1', 'rec-1', true);
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('update failed'));
    const svc = new AutoTuningOptimizer(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.recordFeedback('ws-1', 'rec-1', false);
    expect(result.isErr()).toBe(true);
  });
});

// ─── concludeAbTest ───────────────────────────────────────────────────────────

describe('AutoTuningOptimizer.concludeAbTest', () => {
  it('returns applied when treatment metric improves', async () => {
    const testRow = {
      id: 'test-1',
      recommendation_id: 'rec-1',
      status: 'concluded',
      control_metric: '0.7',
      treatment_metric: '0.85',
      conclusion_at: '2026-06-08T12:00:00Z',
    };
    const svc = new AutoTuningOptimizer(makeSql([testRow], []));
    const result = await svc.concludeAbTest('test-1', 0.7, 0.85);
    expect(result.isOk()).toBe(true);
    const test = result._unsafeUnwrap();
    expect(test.improvementPct).toBeGreaterThan(0);
  });

  it('returns negative improvement when treatment metric degrades', async () => {
    const testRow = {
      id: 'test-2',
      recommendation_id: 'rec-2',
      status: 'concluded',
      control_metric: '0.8',
      treatment_metric: '0.7',
      conclusion_at: '2026-06-08T12:00:00Z',
    };
    const svc = new AutoTuningOptimizer(makeSql([testRow], []));
    const result = await svc.concludeAbTest('test-2', 0.8, 0.7);
    expect(result.isOk()).toBe(true);
    const test = result._unsafeUnwrap();
    expect(test.improvementPct).toBeLessThan(0);
  });

  it('returns err when test not found', async () => {
    const svc = new AutoTuningOptimizer(makeSql([]));
    const result = await svc.concludeAbTest('missing', 0.7, 0.8);
    expect(result.isErr()).toBe(true);
  });
});
