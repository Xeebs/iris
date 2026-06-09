import { describe, it, expect, vi } from 'vitest';
import {
  scoreInsightValue,
  classifyInsightSeverity,
  computeNextRunAt,
  generateInsightTitle,
  InsightGenerator,
} from '../insight-generator.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── scoreInsightValue ────────────────────────────────────────────────────────

describe('scoreInsightValue', () => {
  it('returns higher score for more affected entities', () => {
    const low = scoreInsightValue(1, 'pattern', 'info');
    const high = scoreInsightValue(100, 'pattern', 'info');
    expect(high).toBeGreaterThan(low);
  });

  it('scores anomaly type higher than pattern', () => {
    const anomaly = scoreInsightValue(10, 'anomaly', 'info');
    const pattern = scoreInsightValue(10, 'pattern', 'info');
    expect(anomaly).toBeGreaterThan(pattern);
  });

  it('scores critical severity higher than info', () => {
    const critical = scoreInsightValue(10, 'trend', 'critical');
    const info = scoreInsightValue(10, 'trend', 'info');
    expect(critical).toBeGreaterThan(info);
  });

  it('caps breadth contribution at 40', () => {
    const capped = scoreInsightValue(1000, 'pattern', 'info');
    expect(capped).toBeLessThanOrEqual(100);
  });

  it('returns 0 for all minimums', () => {
    const score = scoreInsightValue(0, 'pattern', 'info');
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ─── classifyInsightSeverity ──────────────────────────────────────────────────

describe('classifyInsightSeverity', () => {
  it('returns critical for high-count anomaly', () => {
    expect(classifyInsightSeverity(60, 'anomaly')).toBe('critical');
  });

  it('returns critical for missing_data with > 20 entities', () => {
    expect(classifyInsightSeverity(25, 'missing_data')).toBe('critical');
  });

  it('returns warning for any anomaly', () => {
    expect(classifyInsightSeverity(5, 'anomaly')).toBe('warning');
  });

  it('returns warning for large affected count', () => {
    expect(classifyInsightSeverity(30, 'trend')).toBe('warning');
  });

  it('returns info for small count and low-risk type', () => {
    expect(classifyInsightSeverity(5, 'pattern')).toBe('info');
  });
});

// ─── computeNextRunAt ─────────────────────────────────────────────────────────

describe('computeNextRunAt', () => {
  it('returns a date strictly after from for daily', () => {
    const from = new Date();
    const next = computeNextRunAt('daily', from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('daily next run is within 48 hours', () => {
    const from = new Date();
    const next = computeNextRunAt('daily', from);
    const msAdded = next.getTime() - from.getTime();
    expect(msAdded).toBeLessThan(48 * 3600 * 1000);
  });

  it('weekly next run is within 8 days', () => {
    const from = new Date();
    const next = computeNextRunAt('weekly', from);
    const msAdded = next.getTime() - from.getTime();
    expect(msAdded).toBeLessThan(8 * 86400 * 1000);
    expect(msAdded).toBeGreaterThan(0);
  });

  it('always sets hour to 6', () => {
    const from = new Date('2026-01-01T12:00:00');
    const next = computeNextRunAt('daily', from);
    expect(next.getHours()).toBe(6);
  });
});

// ─── generateInsightTitle ─────────────────────────────────────────────────────

describe('generateInsightTitle', () => {
  it('includes entity type', () => {
    const title = generateInsightTitle('anomaly', 'contact', 10);
    expect(title.toLowerCase()).toContain('contact');
  });

  it('includes affected count', () => {
    const title = generateInsightTitle('trend', 'deal', 42);
    expect(title).toContain('42');
  });

  it('produces different titles for different types', () => {
    const a = generateInsightTitle('anomaly', 'entity', 5);
    const b = generateInsightTitle('pattern', 'entity', 5);
    expect(a).not.toBe(b);
  });
});

// ─── InsightGenerator ─────────────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('InsightGenerator.discoverInsights', () => {
  it('generates missing_data insight when count > 0', async () => {
    const sql = makeSql([{ missing_count: 15 }]);
    const gen = new InsightGenerator(sql);
    const result = await gen.discoverInsights(['contact']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]!.insightType).toBe('missing_data');
  });

  it('returns empty when no missing data found', async () => {
    const sql = makeSql([{ missing_count: 0 }]);
    const gen = new InsightGenerator(sql);
    const result = await gen.discoverInsights(['contact']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<typeof import('postgres').default>;
    const gen = new InsightGenerator(sql);
    const result = await gen.discoverInsights(['contact']);
    expect(result.isErr()).toBe(true);
  });
});

describe('InsightGenerator.generateInsightReport', () => {
  it('returns structured report', async () => {
    const rows = [{
      id: 'i1', entity_type: 'contact', insight_type: 'missing_data',
      title: 'Test', summary: 'Test', affected_count: 5,
      severity: 'warning', value_score: 50, evidence: '[]', detected_at: new Date(),
    }];
    const sql = makeSql(rows);
    const gen = new InsightGenerator(sql);
    const result = await gen.generateInsightReport('contact', 'daily');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalInsights).toBe(1);
    expect(result._unsafeUnwrap().warningCount).toBe(1);
  });
});

describe('InsightGenerator.listInsights', () => {
  it('returns empty when no insights', async () => {
    const gen = new InsightGenerator(makeSql([]));
    const result = await gen.listInsights();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().insights).toHaveLength(0);
  });

  it('returns nextCursor when hasMore', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `i${i}`, entity_type: 'contact', insight_type: 'pattern',
      title: 'T', summary: 'S', affected_count: 1,
      severity: 'info', value_score: 10, evidence: '[]', detected_at: new Date(),
    }));
    const gen = new InsightGenerator(makeSql(rows));
    const result = await gen.listInsights({ limit: 20 });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().nextCursor).not.toBeNull();
  });
});

describe('InsightGenerator.saveInsight', () => {
  it('returns saved insight with id and detectedAt', async () => {
    const gen = new InsightGenerator(makeSql([]));
    const result = await gen.saveInsight({
      entityType: 'contact', insightType: 'missing_data', title: 'T', summary: 'S',
      affectedCount: 5, severity: 'warning', valueScore: 50, evidence: ['test'],
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().id).toBeTruthy();
  });
});

describe('InsightGenerator.scheduleInsightGeneration', () => {
  it('returns scheduled report record', async () => {
    const gen = new InsightGenerator(makeSql([]));
    const result = await gen.scheduleInsightGeneration(['contact', 'deal'], 'weekly', ['user@example.com']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().entityTypes).toEqual(['contact', 'deal']);
  });
});

describe('InsightGenerator.submitFeedback', () => {
  it('returns ok on success', async () => {
    const gen = new InsightGenerator(makeSql([]));
    const result = await gen.submitFeedback('insight-1', true);
    expect(result.isOk()).toBe(true);
  });
});

describe('InsightGenerator.listScheduledReports', () => {
  it('returns empty when none scheduled', async () => {
    const gen = new InsightGenerator(makeSql([]));
    const result = await gen.listScheduledReports();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});
