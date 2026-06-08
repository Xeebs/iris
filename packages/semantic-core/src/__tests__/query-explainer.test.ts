import { describe, it, expect, vi } from 'vitest';
import {
  freshnessBonus,
  relationshipBonus,
  typeMatchBonus,
  buildRelevanceReason,
  breakdownScoring,
  QueryExplainer,
  type ScoringBreakdown,
} from '../query-explainer.js';
import type { VectorSearchResult } from '../vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(id: string, type = 'contact', daysOld = 5, relIds: string[] = []): SemanticEntity {
  const lastModified = new Date(Date.now() - daysOld * 86_400_000);
  return {
    id,
    type,
    label: `Label ${id}`,
    attributes: {},
    relationships: relIds.map((r) => ({ type: 'related_to', targetId: r })),
    lastModified,
    sourceId: id,
  };
}

function makeResult(entity: SemanticEntity, score = 0.85): VectorSearchResult {
  return { entity, score };
}

// ─── freshnessBonus ───────────────────────────────────────────────────────────

describe('freshnessBonus', () => {
  it('returns 0.1 for entities modified within 7 days', () => {
    expect(freshnessBonus(new Date(Date.now() - 3 * 86_400_000))).toBe(0.1);
  });

  it('returns 0 for entities older than 90 days', () => {
    expect(freshnessBonus(new Date(Date.now() - 100 * 86_400_000))).toBe(0);
  });

  it('returns a value between 0 and 0.1 for entities between 7 and 90 days old', () => {
    const bonus = freshnessBonus(new Date(Date.now() - 30 * 86_400_000));
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThan(0.1);
  });
});

// ─── relationshipBonus ────────────────────────────────────────────────────────

describe('relationshipBonus', () => {
  it('returns 0 for no relationships', () => {
    expect(relationshipBonus([])).toBe(0);
  });

  it('returns 0.01 for 1 relationship', () => {
    expect(relationshipBonus([{ type: 'r', targetId: 'x' }])).toBe(0.01);
  });

  it('caps at 0.05 for 5+ relationships', () => {
    const rels = Array.from({ length: 10 }, (_, i) => ({ type: 'r', targetId: `x${i}` }));
    expect(relationshipBonus(rels)).toBe(0.05);
  });
});

// ─── typeMatchBonus ───────────────────────────────────────────────────────────

describe('typeMatchBonus', () => {
  it('returns 0.05 when entity type appears in query', () => {
    expect(typeMatchBonus('contact', 'show me all contacts in the pipeline')).toBe(0.05);
  });

  it('returns 0 when entity type does not appear in query', () => {
    expect(typeMatchBonus('deal', 'show me contacts')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(typeMatchBonus('Contact', 'list CONTACTS by stage')).toBe(0.05);
  });
});

// ─── breakdownScoring ─────────────────────────────────────────────────────────

describe('breakdownScoring', () => {
  it('returns correct vectorSimilarity from result score', () => {
    const entity = makeEntity('e:1', 'contact', 2);
    const result = makeResult(entity, 0.9);
    const bd = breakdownScoring(result, 'find contacts');
    expect(bd.vectorSimilarity).toBe(0.9);
  });

  it('includes type match bonus when type appears in query', () => {
    const entity = makeEntity('e:1', 'contact', 2);
    const result = makeResult(entity, 0.8);
    const bd = breakdownScoring(result, 'find contacts');
    expect(bd.typeMatchBonus).toBe(0.05);
  });

  it('returns 0 typeMatchBonus when type not in query', () => {
    const entity = makeEntity('e:1', 'deal', 2);
    const result = makeResult(entity, 0.8);
    const bd = breakdownScoring(result, 'find contacts');
    expect(bd.typeMatchBonus).toBe(0);
  });

  it('totalScore is sum of all factors', () => {
    const entity = makeEntity('e:1', 'contact', 3, ['x:1']);
    const result = makeResult(entity, 0.8);
    const bd = breakdownScoring(result, 'find contacts');
    const expected = Math.round((bd.vectorSimilarity + bd.freshnessBonus + bd.relationshipBonus + bd.typeMatchBonus) * 1000) / 1000;
    expect(bd.totalScore).toBe(expected);
  });
});

// ─── buildRelevanceReason ─────────────────────────────────────────────────────

describe('buildRelevanceReason', () => {
  it('includes semantic similarity percentage', () => {
    const scoring: ScoringBreakdown = {
      entityId: 'e:1', totalScore: 0.9, vectorSimilarity: 0.85,
      freshnessBonus: 0, relationshipBonus: 0, typeMatchBonus: 0, label: 'L', type: 't',
    };
    expect(buildRelevanceReason(scoring)).toContain('85%');
  });

  it('includes recently updated when freshnessBonus > 0', () => {
    const scoring: ScoringBreakdown = {
      entityId: 'e:1', totalScore: 0.9, vectorSimilarity: 0.8,
      freshnessBonus: 0.1, relationshipBonus: 0, typeMatchBonus: 0, label: 'L', type: 't',
    };
    expect(buildRelevanceReason(scoring)).toContain('recently updated');
  });

  it('includes type matches query when typeMatchBonus > 0', () => {
    const scoring: ScoringBreakdown = {
      entityId: 'e:1', totalScore: 0.95, vectorSimilarity: 0.8,
      freshnessBonus: 0, relationshipBonus: 0, typeMatchBonus: 0.05, label: 'L', type: 't',
    };
    expect(buildRelevanceReason(scoring)).toContain('type matches query');
  });
});

// ─── QueryExplainer ───────────────────────────────────────────────────────────

describe('QueryExplainer', () => {
  const explainer = new QueryExplainer();

  describe('explainRetrieval', () => {
    it('returns explanation with correct total count', () => {
      const results = [makeResult(makeEntity('e:1')), makeResult(makeEntity('e:2'))];
      const explanation = explainer.explainRetrieval('find contacts', results);
      expect(explanation.totalRetrieved).toBe(2);
    });

    it('computes entity type distribution', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact')),
        makeResult(makeEntity('e:2', 'contact')),
        makeResult(makeEntity('e:3', 'deal')),
      ];
      const explanation = explainer.explainRetrieval('query', results);
      expect(explanation.entityTypeDistribution['contact']).toBe(2);
      expect(explanation.entityTypeDistribution['deal']).toBe(1);
    });

    it('computes average score', () => {
      const results = [makeResult(makeEntity('e:1'), 0.8), makeResult(makeEntity('e:2'), 0.6)];
      const explanation = explainer.explainRetrieval('query', results);
      expect(explanation.avgScore).toBe(0.7);
    });

    it('includes relevance reason for each entity', () => {
      const results = [makeResult(makeEntity('e:1', 'contact', 2), 0.9)];
      const explanation = explainer.explainRetrieval('find contacts', results);
      expect(explanation.explanations[0]!.relevanceReason).toBeTruthy();
    });
  });

  describe('detectRetrievalAnomaly', () => {
    it('detects empty results', () => {
      const anomalies = explainer.detectRetrievalAnomaly('query', []);
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]!.type).toBe('empty_results');
      expect(anomalies[0]!.severity).toBe('critical');
    });

    it('detects single entity type anomaly', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact')),
        makeResult(makeEntity('e:2', 'contact')),
        makeResult(makeEntity('e:3', 'contact')),
      ];
      const anomalies = explainer.detectRetrievalAnomaly('find opportunities', results);
      const single = anomalies.find((a) => a.type === 'single_entity_type');
      expect(single).toBeDefined();
      expect(single!.severity).toBe('warning');
    });

    it('does NOT flag single_entity_type for fewer than 3 results', () => {
      const results = [makeResult(makeEntity('e:1', 'contact')), makeResult(makeEntity('e:2', 'contact'))];
      const anomalies = explainer.detectRetrievalAnomaly('find contacts', results);
      expect(anomalies.find((a) => a.type === 'single_entity_type')).toBeUndefined();
    });

    it('detects low average score', () => {
      const results = [makeResult(makeEntity('e:1'), 0.3), makeResult(makeEntity('e:2'), 0.3)];
      const anomalies = explainer.detectRetrievalAnomaly('query', results);
      const lowScore = anomalies.find((a) => a.type === 'low_avg_score');
      expect(lowScore).toBeDefined();
      expect(lowScore!.severity).toBe('critical');
    });

    it('detects low_avg_score as warning when between 0.3 and 0.5', () => {
      const results = [makeResult(makeEntity('e:1'), 0.4), makeResult(makeEntity('e:2'), 0.4)];
      const anomalies = explainer.detectRetrievalAnomaly('query', results);
      const lowScore = anomalies.find((a) => a.type === 'low_avg_score');
      expect(lowScore).toBeDefined();
      expect(lowScore!.severity).toBe('warning');
    });

    it('detects all_stale when every entity is 90+ days old', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact', 100)),
        makeResult(makeEntity('e:2', 'contact', 120)),
      ];
      const anomalies = explainer.detectRetrievalAnomaly('query', results);
      const stale = anomalies.find((a) => a.type === 'all_stale');
      expect(stale).toBeDefined();
    });

    it('does not flag all_stale when at least one entity is recent', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact', 100)),
        makeResult(makeEntity('e:2', 'contact', 5)),
      ];
      const anomalies = explainer.detectRetrievalAnomaly('query', results);
      expect(anomalies.find((a) => a.type === 'all_stale')).toBeUndefined();
    });
  });

  describe('suggestContextExpansion', () => {
    it('returns empty when no relationships', () => {
      const results = [makeResult(makeEntity('e:1'))];
      const suggestions = explainer.suggestContextExpansion(results);
      expect(suggestions).toHaveLength(0);
    });

    it('suggests related entities not in current results', () => {
      const results = [makeResult(makeEntity('e:1', 'contact', 5, ['deal:related:1']))];
      const suggestions = explainer.suggestContextExpansion(results);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.entityId).toBe('deal:related:1');
      expect(suggestions[0]!.sourceEntityId).toBe('e:1');
    });

    it('does not suggest already-retrieved entities', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact', 5, ['e:2'])),
        makeResult(makeEntity('e:2', 'company')),
      ];
      const suggestions = explainer.suggestContextExpansion(results);
      expect(suggestions.map((s) => s.entityId)).not.toContain('e:2');
    });

    it('deduplicates suggestions when multiple entities point to the same target', () => {
      const results = [
        makeResult(makeEntity('e:1', 'contact', 5, ['shared:target:1'])),
        makeResult(makeEntity('e:2', 'contact', 5, ['shared:target:1'])),
      ];
      const suggestions = explainer.suggestContextExpansion(results);
      const targetCount = suggestions.filter((s) => s.entityId === 'shared:target:1').length;
      expect(targetCount).toBe(1);
    });

    it('caps at 10 suggestions', () => {
      const relIds = Array.from({ length: 20 }, (_, i) => `x:${i}`);
      const results = [makeResult(makeEntity('e:1', 'contact', 5, relIds))];
      const suggestions = explainer.suggestContextExpansion(results);
      expect(suggestions).toHaveLength(10);
    });
  });
});
