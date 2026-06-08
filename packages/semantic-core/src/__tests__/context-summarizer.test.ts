import { describe, it, expect, vi } from 'vitest';
import {
  classifyQueryIntent,
  rankContextByTaskRelevance,
  generateTaskSpecificSummary,
  optimizeSummaryStructure,
  recordSummarizationMetrics,
  getSummarizationMetrics,
  type ContextEntity,
} from '../context-summarizer';

const makeEntity = (id: string, type: string, label: string, attrs: Record<string, unknown> = {}): ContextEntity => ({
  id, type, label, attributes: attrs,
});

describe('classifyQueryIntent', () => {
  it('classifies analytical queries', () => {
    expect(classifyQueryIntent('analyze the trend in revenue over time')).toBe('analytical');
    expect(classifyQueryIntent('why is the deal pipeline declining')).toBe('analytical');
    expect(classifyQueryIntent('forecast next quarter results')).toBe('analytical');
  });

  it('classifies operational queries', () => {
    expect(classifyQueryIntent('show me all active contacts')).toBe('operational');
    expect(classifyQueryIntent('find deals closing this week')).toBe('operational');
    expect(classifyQueryIntent('list current tasks')).toBe('operational');
  });

  it('classifies reporting queries', () => {
    expect(classifyQueryIntent('report on total deals by stage')).toBe('reporting');
    expect(classifyQueryIntent('summary of KPI metrics this month')).toBe('reporting');
    expect(classifyQueryIntent('aggregate count of contacts by company')).toBe('reporting');
  });

  it('classifies synthesis queries', () => {
    expect(classifyQueryIntent('combine and synthesize contacts across multiple systems')).toBe('synthesis');
    expect(classifyQueryIntent('merge and consolidate data from all connectors')).toBe('synthesis');
  });

  it('defaults to operational when no signal', () => {
    expect(classifyQueryIntent('hi')).toBe('operational');
    expect(classifyQueryIntent('')).toBe('operational');
  });
});

describe('rankContextByTaskRelevance', () => {
  const entities: ContextEntity[] = [
    makeEntity('1', 'contact', 'Alice', { email: 'alice@co.com', stage: 'customer' }),
    makeEntity('2', 'deal', 'Big Deal', { value: 50000, stage: 'negotiation' }),
    makeEntity('3', 'metric', 'Revenue', { value: 1000000 }),
    makeEntity('4', 'task', 'Follow up', {}),
  ];

  it('ranks metrics highest for analytical intent', () => {
    const ranked = rankContextByTaskRelevance(entities, 'analytical');
    const types = ranked.map(r => r.type);
    expect(types.indexOf('metric')).toBeLessThan(types.indexOf('task'));
  });

  it('ranks contacts highest for operational intent', () => {
    const ranked = rankContextByTaskRelevance(entities, 'operational');
    expect(ranked[0]!.type).toBe('contact');
  });

  it('scores range between 0 and 1', () => {
    const ranked = rankContextByTaskRelevance(entities, 'reporting');
    for (const r of ranked) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it('gives relationship bonus to connected entities', () => {
    const connected = { ...makeEntity('5', 'contact', 'Bob', {}), relationships: [{ type: 'belongs_to', targetId: 'c1' }, { type: 'owns', targetId: 'd1' }] };
    const unconnected = makeEntity('6', 'contact', 'Carol', {});
    const ranked = rankContextByTaskRelevance([connected, unconnected], 'operational');
    expect(ranked[0]!.id).toBe('5');
  });

  it('returns entities in descending relevance order', () => {
    const ranked = rankContextByTaskRelevance(entities, 'synthesis');
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i]!.relevanceScore).toBeGreaterThanOrEqual(ranked[i + 1]!.relevanceScore);
    }
  });
});

describe('generateTaskSpecificSummary', () => {
  const entities = [
    { ...makeEntity('1', 'contact', 'Alice Smith', { email: 'alice@co.com', company: 'Acme Corp' }), relevanceScore: 1, relevanceReason: 'top' },
    { ...makeEntity('2', 'deal', 'Q4 Deal', { value: 75000, stage: 'closing' }), relevanceScore: 0.9, relevanceReason: 'high' },
  ];

  it('produces bullet list for anthropic', () => {
    const summary = generateTaskSpecificSummary(entities, 'operational', 'anthropic', 500);
    expect(summary.format).toBe('bullet_list');
    expect(summary.content).toContain('•');
  });

  it('produces JSON for openai', () => {
    const summary = generateTaskSpecificSummary(entities, 'reporting', 'openai', 500);
    expect(summary.format).toBe('json');
    expect(() => JSON.parse(summary.content)).not.toThrow();
  });

  it('produces prose for gemini', () => {
    const summary = generateTaskSpecificSummary(entities, 'synthesis', 'gemini', 500);
    expect(summary.format).toBe('prose');
    expect(summary.content).not.toContain('•');
  });

  it('compresses content below targetTokens', () => {
    const summary = generateTaskSpecificSummary(entities, 'analytical', 'anthropic', 50);
    expect(summary.summaryTokens).toBeLessThanOrEqual(60);
  });

  it('compression ratio is between 0 and 1', () => {
    const summary = generateTaskSpecificSummary(entities, 'analytical', 'openai', 500);
    expect(summary.compressionRatio).toBeGreaterThanOrEqual(0);
    expect(summary.compressionRatio).toBeLessThanOrEqual(1);
  });

  it('includes intent and provider in result', () => {
    const summary = generateTaskSpecificSummary(entities, 'reporting', 'gemini', 500);
    expect(summary.intent).toBe('reporting');
    expect(summary.provider).toBe('gemini');
  });
});

describe('optimizeSummaryStructure', () => {
  it('minifies JSON format', () => {
    const input = '[\n  { "a": 1 }\n]';
    const result = optimizeSummaryStructure(input, 'json');
    expect(result).toBe('[{"a":1}]');
    expect(result.length).toBeLessThan(input.length);
  });

  it('removes empty lines from bullet list', () => {
    const input = '• Item A\n\n• Item B\n\n• Item C';
    const result = optimizeSummaryStructure(input, 'bullet_list');
    expect(result.split('\n').filter(l => !l.trim())).toHaveLength(0);
  });

  it('collapses whitespace in prose', () => {
    const input = 'Alice is a contact.   Bob is a deal.   ';
    const result = optimizeSummaryStructure(input, 'prose');
    expect(result).toBe('Alice is a contact. Bob is a deal.');
  });

  it('returns original for invalid JSON in json format', () => {
    const input = 'not json at all';
    const result = optimizeSummaryStructure(input, 'json');
    expect(result).toBe(input);
  });
});

describe('recordSummarizationMetrics', () => {
  it('inserts metrics row and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await recordSummarizationMetrics(sql as unknown as Parameters<typeof recordSummarizationMetrics>[0], 'ws1', 2000, 800, 'analytical', 0.9);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await recordSummarizationMetrics(sql as unknown as Parameters<typeof recordSummarizationMetrics>[0], 'ws1', 1000, 400, 'operational');
    expect(result.isErr()).toBe(true);
  });

  it('works without satisfactionScore', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await recordSummarizationMetrics(sql as unknown as Parameters<typeof recordSummarizationMetrics>[0], 'ws1', 500, 200, 'reporting');
    expect(result.isOk()).toBe(true);
  });
});

describe('getSummarizationMetrics', () => {
  it('aggregates metrics by intent', async () => {
    const sql = vi.fn().mockResolvedValue([
      { query_intent: 'analytical', total_count: '30', avg_compression: '0.55', avg_satisfaction: '0.88' },
      { query_intent: 'operational', total_count: '70', avg_compression: '0.42', avg_satisfaction: null },
    ]);
    const result = await getSummarizationMetrics(sql as unknown as Parameters<typeof getSummarizationMetrics>[0], 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.totalSummaries).toBe(100);
      expect(result.value.byIntent.analytical.count).toBe(30);
      expect(result.value.byIntent.operational.avgCompression).toBe(0.42);
    }
  });

  it('returns zeros for empty workspace', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await getSummarizationMetrics(sql as unknown as Parameters<typeof getSummarizationMetrics>[0], 'ws-empty');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.totalSummaries).toBe(0);
      expect(result.value.avgCompressionRatio).toBe(0);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await getSummarizationMetrics(sql as unknown as Parameters<typeof getSummarizationMetrics>[0], 'ws1');
    expect(result.isErr()).toBe(true);
  });
});
