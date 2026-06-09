import { describe, it, expect, beforeEach } from 'vitest';
import { DataQualityEngine } from '../data-quality-engine.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import type { WorkspaceQualityScore, EntityTypeScore, QualityIssue, RemediationAction } from '../data-quality-engine.js';

function makeEntity(
  type: string,
  id: string,
  attrs: Record<string, unknown>,
  lastModified?: string,
  label?: string,
  relationships: SemanticEntity['relationships'] = [],
): SemanticEntity {
  return {
    id,
    type,
    label: label ?? id,
    attributes: attrs,
    relationships,
    lastModified: lastModified ?? new Date().toISOString(),
    sourceId: id,
  };
}

const FRESH_DATE = new Date().toISOString();
const STALE_DATE = new Date(Date.now() - 100 * 86_400_000).toISOString(); // 100 days ago

// ─── scoreEntity ──────────────────────────────────────────────────────────────

describe('DataQualityEngine.scoreEntity', () => {
  const engine = new DataQualityEngine();

  it('scores a fully populated fresh entity near 100', () => {
    const e = makeEntity('contact', 'c1', { name: 'Alice', email: 'a@b.com', company: 'Acme' }, FRESH_DATE);
    const score = engine.scoreEntity(e);
    expect(score.overallScore).toBeGreaterThan(80);
  });

  it('scores an entity with all null fields low on completeness', () => {
    const e = makeEntity('contact', 'c2', { name: null, email: null }, FRESH_DATE);
    const score = engine.scoreEntity(e);
    expect(score.completenessScore).toBe(0);
  });

  it('scores a stale entity lower on freshness', () => {
    const freshE = makeEntity('contact', 'c3', { name: 'Bob' }, FRESH_DATE);
    const staleE = makeEntity('contact', 'c4', { name: 'Bob' }, STALE_DATE);
    expect(engine.scoreEntity(freshE).freshnessScore).toBeGreaterThan(engine.scoreEntity(staleE).freshnessScore);
  });

  it('returns scores between 0 and 100 for overallScore', () => {
    const e = makeEntity('deal', 'd1', { value: 5000, stage: 'open' });
    const score = engine.scoreEntity(e);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });
});

// ─── scoreEntityType ──────────────────────────────────────────────────────────

describe('DataQualityEngine.scoreEntityType', () => {
  const engine = new DataQualityEngine();

  it('returns zero scores for empty entity list', () => {
    const result = engine.scoreEntityType('contact', []);
    expect(result.avgOverallScore).toBe(0);
    expect(result.entityCount).toBe(0);
  });

  it('averages scores across all entities', () => {
    const entities = [
      makeEntity('deal', 'd1', { value: 100 }, FRESH_DATE),
      makeEntity('deal', 'd2', { value: 200 }, FRESH_DATE),
    ];
    const result = engine.scoreEntityType('deal', entities) as EntityTypeScore;
    expect(result.entityCount).toBe(2);
    expect(result.avgOverallScore).toBeGreaterThan(0);
  });
});

// ─── scoreWorkspace ───────────────────────────────────────────────────────────

describe('DataQualityEngine.scoreWorkspace', () => {
  let engine: DataQualityEngine;
  beforeEach(() => { engine = new DataQualityEngine(); });

  it('returns 0 for empty workspace', () => {
    const result = engine.scoreWorkspace('ws-1', new Map());
    expect(result.overallScore).toBe(0);
    expect(result.entityTypeScores).toHaveLength(0);
  });

  it('includes all entity types in result', () => {
    const map = new Map<string, SemanticEntity[]>([
      ['contact', [makeEntity('contact', 'c1', { name: 'Alice' }, FRESH_DATE)]],
      ['deal', [makeEntity('deal', 'd1', { value: 5000 }, FRESH_DATE)]],
    ]);
    const result = engine.scoreWorkspace('ws-1', map) as WorkspaceQualityScore;
    expect(result.entityTypeScores).toHaveLength(2);
  });

  it('weights by entity count', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeEntity('contact', `c${i}`, { name: 'Alice', email: 'a@b.com', phone: '555' }, FRESH_DATE),
    );
    const few = [makeEntity('deal', 'd1', { value: null }, STALE_DATE)];
    const map = new Map([['contact', many], ['deal', few]]);
    const result = engine.scoreWorkspace('ws-2', map);
    expect(result.overallScore).toBeGreaterThan(50);
  });
});

// ─── detectQualityIssues ──────────────────────────────────────────────────────

describe('DataQualityEngine.detectQualityIssues', () => {
  let engine: DataQualityEngine;
  beforeEach(() => { engine = new DataQualityEngine(); });

  it('returns empty array for clean fresh data', () => {
    const map = new Map<string, SemanticEntity[]>([
      ['contact', [
        makeEntity('contact', 'c1', { name: 'Alice', email: 'a@b.com' }, FRESH_DATE, 'Alice'),
        makeEntity('contact', 'c2', { name: 'Bob', email: 'b@b.com' }, FRESH_DATE, 'Bob'),
      ]],
    ]);
    const issues = engine.detectQualityIssues('ws-1', map);
    expect(issues.filter((i) => i.issueType === 'stale')).toHaveLength(0);
    expect(issues.filter((i) => i.issueType === 'duplicates')).toHaveLength(0);
  });

  it('detects stale entities', () => {
    const map = new Map<string, SemanticEntity[]>([
      ['contact', Array.from({ length: 5 }, (_, i) =>
        makeEntity('contact', `c${i}`, { name: `Person ${i}` }, STALE_DATE, `Person ${i}`),
      )],
    ]);
    const issues = engine.detectQualityIssues('ws-1', map);
    const stale = issues.filter((i) => i.issueType === 'stale');
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0]!.affectedCount).toBe(5);
  });

  it('detects duplicate entities with same label', () => {
    const map = new Map<string, SemanticEntity[]>([
      ['contact', [
        makeEntity('contact', 'c1', { name: 'Alice' }, FRESH_DATE, 'alice'),
        makeEntity('contact', 'c2', { name: 'Alice' }, FRESH_DATE, 'alice'),
        makeEntity('contact', 'c3', { name: 'Alice' }, FRESH_DATE, 'alice'),
      ]],
    ]);
    const issues = engine.detectQualityIssues('ws-1', map);
    const dupes = issues.filter((i) => i.issueType === 'duplicates');
    expect(dupes.length).toBeGreaterThan(0);
    expect(dupes[0]!.affectedCount).toBeGreaterThan(0);
  });

  it('detects incomplete entities', () => {
    const map = new Map<string, SemanticEntity[]>([
      ['contact', [
        makeEntity('contact', 'c1', { name: null, email: null, phone: null, company: null }, FRESH_DATE),
        makeEntity('contact', 'c2', { name: null, email: null, phone: null, company: null }, FRESH_DATE),
      ]],
    ]);
    const issues = engine.detectQualityIssues('ws-1', map);
    const invalid = issues.filter((i) => i.issueType === 'invalid');
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('assigns correct severity for large stale batch', () => {
    const manyStale = Array.from({ length: 20 }, (_, i) =>
      makeEntity('contact', `c${i}`, { name: `P${i}` }, STALE_DATE, `P${i}`),
    );
    const map = new Map([['contact', manyStale]]);
    const issues = engine.detectQualityIssues('ws-1', map);
    const stale = issues.find((i) => i.issueType === 'stale') as QualityIssue;
    expect(['medium', 'high']).toContain(stale.severity);
  });
});

// ─── recommendRemediation ─────────────────────────────────────────────────────

describe('DataQualityEngine.recommendRemediation', () => {
  const engine = new DataQualityEngine();

  it('recommends dedup action for duplicates issue', () => {
    const issue: QualityIssue = {
      issueId: 'ws-1:dupes:contact:1', issueType: 'duplicates', entityType: 'contact',
      affectedCount: 25, severity: 'medium', description: 'duplicates', firstDetectedAt: new Date(),
    };
    const action = engine.recommendRemediation(issue) as RemediationAction;
    expect(action.actionType).toBe('run_dedup');
    expect(action.status).toBe('pending');
  });

  it('recommends sync for stale issue', () => {
    const issue: QualityIssue = {
      issueId: 'ws-1:stale:deal:2', issueType: 'stale', entityType: 'deal',
      affectedCount: 10, severity: 'low', description: 'stale', firstDetectedAt: new Date(),
    };
    const action = engine.recommendRemediation(issue);
    expect(action.actionType).toBe('trigger_sync');
  });

  it('recommends enrichment for invalid issue', () => {
    const issue: QualityIssue = {
      issueId: 'ws-1:invalid:contact:3', issueType: 'invalid', entityType: 'contact',
      affectedCount: 30, severity: 'high', description: 'incomplete', firstDetectedAt: new Date(),
    };
    const action = engine.recommendRemediation(issue);
    expect(action.actionType).toBe('enrich_entities');
  });

  it('recommends entity linking for missing_relationship issue', () => {
    const issue: QualityIssue = {
      issueId: 'ws-1:rel:contact:4', issueType: 'missing_relationship', entityType: 'contact',
      affectedCount: 5, severity: 'low', description: 'no relationships', firstDetectedAt: new Date(),
    };
    const action = engine.recommendRemediation(issue);
    expect(action.actionType).toBe('link_entities');
  });
});
