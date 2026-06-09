import { describe, it, expect, beforeEach } from 'vitest';
import { ComputedMetricEngine } from '../computed-metrics.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import type { MetricDefinition, ComputeResult, ExplainResult } from '../computed-metrics.js';

function makeEntity(type: string, id: string, attrs: Record<string, unknown>): SemanticEntity {
  return { id, type, label: id, attributes: attrs, relationships: [], lastModified: new Date().toISOString(), sourceId: id };
}

// ─── parseFormula ─────────────────────────────────────────────────────────────

describe('ComputedMetricEngine.parseFormula', () => {
  const engine = new ComputedMetricEngine();

  it('parses a simple number literal', () => {
    const ast = engine.parseFormula('42');
    expect(ast).toMatchObject({ kind: 'number', value: 42 });
  });

  it('parses sum aggregate', () => {
    const ast = engine.parseFormula('sum(subscription.mrr)');
    expect(ast).toMatchObject({ kind: 'aggregate', fn: 'sum', entityType: 'subscription', fieldName: 'mrr' });
  });

  it('parses multiplication with aggregate', () => {
    const ast = engine.parseFormula('sum(subscription.mrr) * 12');
    expect(ast).toMatchObject({ kind: 'binary', op: '*' });
  });

  it('parses complex formula with addition', () => {
    const ast = engine.parseFormula('sum(deal.value) + count(contact.id)');
    expect(ast).toMatchObject({ kind: 'binary', op: '+' });
  });

  it('returns parse_error for unknown character', () => {
    const result = engine.parseFormula('sum(a.b) @ 12');
    expect(result).toMatchObject({ kind: 'parse_error' });
  });

  it('returns parse_error for malformed aggregate (missing dot)', () => {
    const result = engine.parseFormula('sum(subscriptionmrr)');
    expect(result).toMatchObject({ kind: 'parse_error' });
  });
});

// ─── validateFormula ──────────────────────────────────────────────────────────

describe('ComputedMetricEngine.validateFormula', () => {
  const engine = new ComputedMetricEngine();

  it('returns null for valid formula', () => {
    const ast = engine.parseFormula('sum(subscription.mrr) * 12');
    expect(ast).not.toHaveProperty('kind', 'parse_error');
    const err = engine.validateFormula(ast as never, new Set(['subscription']));
    expect(err).toBeNull();
  });

  it('returns validation_error for unknown entity type', () => {
    const ast = engine.parseFormula('sum(unknown_entity.mrr)');
    expect(ast).not.toHaveProperty('kind', 'parse_error');
    const err = engine.validateFormula(ast as never, new Set(['subscription', 'deal']));
    expect(err).toMatchObject({ kind: 'validation_error', field: 'unknown_entity' });
  });

  it('returns null when formula uses only literals', () => {
    const ast = engine.parseFormula('100 + 200');
    expect(ast).not.toHaveProperty('kind', 'parse_error');
    const err = engine.validateFormula(ast as never, new Set());
    expect(err).toBeNull();
  });
});

// ─── defineMetric ─────────────────────────────────────────────────────────────

describe('ComputedMetricEngine.defineMetric', () => {
  let engine: ComputedMetricEngine;
  beforeEach(() => { engine = new ComputedMetricEngine(); });

  it('defines a metric and returns definition', () => {
    const result = engine.defineMetric('ws-1', 'ARR', 'sum(subscription.mrr) * 12', 'Annual recurring revenue');
    expect(result).not.toHaveProperty('kind');
    expect((result as MetricDefinition).name).toBe('ARR');
    expect((result as MetricDefinition).workspaceId).toBe('ws-1');
  });

  it('returns parse_error for invalid formula', () => {
    const result = engine.defineMetric('ws-1', 'Bad', 'sum(a.b @', 'test');
    expect(result).toMatchObject({ kind: 'parse_error' });
  });

  it('lists defined metrics for workspace', () => {
    engine.defineMetric('ws-2', 'Metric A', 'sum(deal.value)', 'desc');
    engine.defineMetric('ws-2', 'Metric B', 'count(contact.id)', 'desc');
    const list = engine.listMetrics('ws-2');
    expect(list).toHaveLength(2);
  });

  it('does not return metrics for other workspaces', () => {
    engine.defineMetric('ws-A', 'M', 'sum(deal.value)', 'd');
    expect(engine.listMetrics('ws-B')).toHaveLength(0);
  });
});

// ─── computeMetric ────────────────────────────────────────────────────────────

describe('ComputedMetricEngine.computeMetric', () => {
  let engine: ComputedMetricEngine;
  beforeEach(() => { engine = new ComputedMetricEngine(); });

  it('computes ARR correctly (sum * 12)', () => {
    engine.defineMetric('ws-1', 'ARR', 'sum(subscription.mrr) * 12', 'Annual revenue');
    const entities = new Map<string, SemanticEntity[]>([
      ['subscription', [
        makeEntity('subscription', 's1', { mrr: 100 }),
        makeEntity('subscription', 's2', { mrr: 200 }),
        makeEntity('subscription', 's3', { mrr: 300 }),
      ]],
    ]);
    const result = engine.computeMetric('ws-1:arr', entities) as ComputeResult;
    expect(result.value).toBe(7200); // (100+200+300)*12
  });

  it('computes average correctly', () => {
    engine.defineMetric('ws-1', 'AvgDeal', 'avg(deal.value)', 'Average deal size');
    const entities = new Map<string, SemanticEntity[]>([
      ['deal', [
        makeEntity('deal', 'd1', { value: 1000 }),
        makeEntity('deal', 'd2', { value: 3000 }),
      ]],
    ]);
    const result = engine.computeMetric('ws-1:avgdeal', entities) as ComputeResult;
    expect(result.value).toBe(2000);
  });

  it('returns 0 instead of error on division by zero', () => {
    engine.defineMetric('ws-1', 'Ratio', 'sum(deal.value) / count(deal.id)', 'ratio');
    const entities = new Map<string, SemanticEntity[]>([['deal', []]]);
    const result = engine.computeMetric('ws-1:ratio', entities);
    expect(result).not.toHaveProperty('kind', 'compute_error');
  });

  it('returns compute_error for unknown metricId', () => {
    const result = engine.computeMetric('non:existent', new Map());
    expect(result).toMatchObject({ kind: 'compute_error' });
  });

  it('includes entity count and timing in result', () => {
    engine.defineMetric('ws-1', 'X', 'count(contact.id)', 'x');
    const entities = new Map<string, SemanticEntity[]>([
      ['contact', [makeEntity('contact', 'c1', { id: 'c1' })]],
    ]);
    const result = engine.computeMetric('ws-1:x', entities) as ComputeResult;
    expect(result.entityCountUsed).toBe(1);
    expect(typeof result.executionTimeMs).toBe('number');
  });
});

// ─── explainComputation ───────────────────────────────────────────────────────

describe('ComputedMetricEngine.explainComputation', () => {
  let engine: ComputedMetricEngine;
  beforeEach(() => { engine = new ComputedMetricEngine(); });

  it('returns explain result with intermediate steps', () => {
    engine.defineMetric('ws-1', 'ARR', 'sum(subscription.mrr) * 12', 'Annual revenue');
    const entities = new Map<string, SemanticEntity[]>([
      ['subscription', [makeEntity('subscription', 's1', { mrr: 500 })]],
    ]);
    const result = engine.explainComputation('ws-1:arr', entities) as ExplainResult;
    expect(result.finalValue).toBe(6000);
    expect(result.intermediateSteps.length).toBeGreaterThan(0);
    expect(result.formulaText).toBe('sum(subscription.mrr) * 12');
  });

  it('includes sample entities in explanation', () => {
    engine.defineMetric('ws-1', 'ARR', 'sum(subscription.mrr) * 12', 'Annual revenue');
    const entities = new Map<string, SemanticEntity[]>([
      ['subscription', [makeEntity('subscription', 's1', { mrr: 100 })]],
    ]);
    const result = engine.explainComputation('ws-1:arr', entities) as ExplainResult;
    expect(result.sampleEntities.length).toBeGreaterThan(0);
    expect(result.sampleEntities[0]!.id).toBe('s1');
  });

  it('returns compute_error for unknown metricId', () => {
    const result = engine.explainComputation('non:existent', new Map());
    expect(result).toMatchObject({ kind: 'compute_error' });
  });
});
