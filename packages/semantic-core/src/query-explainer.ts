import { logger } from '@iris/core/logger';
import type { VectorSearchResult, VectorStore } from './vector-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'query-explainer' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScoringBreakdown = {
  entityId: string;
  totalScore: number;
  vectorSimilarity: number;
  freshnessBonus: number;
  relationshipBonus: number;
  typeMatchBonus: number;
  label: string;
  type: string;
};

export type EntityExplanation = {
  entity: SemanticEntity;
  score: number;
  scoring: ScoringBreakdown;
  relevanceReason: string;
};

export type RetrievalExplanation = {
  query: string;
  totalRetrieved: number;
  entityTypeDistribution: Record<string, number>;
  explanations: EntityExplanation[];
  anomalies: RetrievalAnomaly[];
  expansionSuggestions: ExpansionSuggestion[];
  avgScore: number;
};

export type RetrievalAnomaly = {
  type: 'single_entity_type' | 'low_avg_score' | 'empty_results' | 'all_stale';
  description: string;
  severity: 'info' | 'warning' | 'critical';
};

export type ExpansionSuggestion = {
  entityId: string;
  label: string;
  type: string;
  relationshipType: string;
  sourceEntityId: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const STALE_DAYS = 90;

/**
 * Compute a freshness bonus (0–0.1) based on how recently the entity was modified.
 * Entities modified within 7 days get full bonus; stale entities (90+ days) get 0.
 */
export function freshnessBonus(lastModified: Date, now = new Date()): number {
  const ageMs = now.getTime() - lastModified.getTime();
  const ageDays = ageMs / MS_PER_DAY;
  if (ageDays <= 7) return 0.1;
  if (ageDays >= STALE_DAYS) return 0;
  return Math.round((0.1 * (1 - ageDays / STALE_DAYS)) * 1000) / 1000;
}

/**
 * Compute a relationship expansion bonus (0–0.05) based on relationship count.
 * Entities with more relationships carry richer graph context.
 */
export function relationshipBonus(relationships: SemanticEntity['relationships']): number {
  const count = relationships.length;
  if (count === 0) return 0;
  return Math.min(count * 0.01, 0.05);
}

/**
 * Returns 0.05 if the entity type appears in the query text (case-insensitive), else 0.
 */
export function typeMatchBonus(entityType: string, query: string): number {
  return query.toLowerCase().includes(entityType.toLowerCase()) ? 0.05 : 0;
}

/**
 * Build a human-readable relevance reason from scoring factors.
 */
export function buildRelevanceReason(scoring: ScoringBreakdown): string {
  const parts: string[] = [`semantic similarity ${(scoring.vectorSimilarity * 100).toFixed(0)}%`];
  if (scoring.freshnessBonus > 0) parts.push('recently updated');
  if (scoring.relationshipBonus > 0) parts.push('well-connected in graph');
  if (scoring.typeMatchBonus > 0) parts.push('type matches query');
  return parts.join(', ');
}

/**
 * Break down a retrieval result's score into constituent factors.
 */
export function breakdownScoring(result: VectorSearchResult, query: string): ScoringBreakdown {
  const { entity, score } = result;
  const fb = freshnessBonus(entity.lastModified);
  const rb = relationshipBonus(entity.relationships);
  const tmb = typeMatchBonus(entity.type, query);

  return {
    entityId: entity.id,
    totalScore: Math.round((score + fb + rb + tmb) * 1000) / 1000,
    vectorSimilarity: Math.round(score * 1000) / 1000,
    freshnessBonus: fb,
    relationshipBonus: rb,
    typeMatchBonus: tmb,
    label: entity.label,
    type: entity.type,
  };
}

// ─── QueryExplainer class ─────────────────────────────────────────────────────

export class QueryExplainer {
  constructor(private readonly vectorStore?: VectorStore) {}

  /**
   * Analyze why each entity was retrieved and provide a complete explanation.
   *
   * @param query   - Original query string
   * @param results - Retrieval results from the vector store
   */
  explainRetrieval(query: string, results: VectorSearchResult[]): RetrievalExplanation {
    log.debug('Explaining retrieval', { query, resultCount: results.length });

    const explanations: EntityExplanation[] = results.map((r) => {
      const scoring = breakdownScoring(r, query);
      return {
        entity: r.entity,
        score: r.score,
        scoring,
        relevanceReason: buildRelevanceReason(scoring),
      };
    });

    const typeDistribution: Record<string, number> = {};
    for (const r of results) {
      typeDistribution[r.entity.type] = (typeDistribution[r.entity.type] ?? 0) + 1;
    }

    const avgScore = results.length > 0
      ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 1000) / 1000
      : 0;

    const anomalies = this.detectRetrievalAnomaly(query, results);
    const expansionSuggestions = this.suggestContextExpansion(results);

    return {
      query,
      totalRetrieved: results.length,
      entityTypeDistribution: typeDistribution,
      explanations,
      anomalies,
      expansionSuggestions,
      avgScore,
    };
  }

  /**
   * Detect anomalous retrieval patterns that may indicate poor context quality.
   *
   * @param query   - Original query string
   * @param results - Retrieval results
   */
  detectRetrievalAnomaly(query: string, results: VectorSearchResult[]): RetrievalAnomaly[] {
    const anomalies: RetrievalAnomaly[] = [];

    if (results.length === 0) {
      anomalies.push({
        type: 'empty_results',
        description: `No entities retrieved for query "${query}". Check embedding alignment or try broader terms.`,
        severity: 'critical',
      });
      return anomalies;
    }

    const types = new Set(results.map((r) => r.entity.type));
    if (types.size === 1 && results.length >= 3) {
      anomalies.push({
        type: 'single_entity_type',
        description: `All ${results.length} retrieved entities are of type "${[...types][0]}". Consider expanding entity type filters if the query is multi-domain.`,
        severity: 'warning',
      });
    }

    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    if (avgScore < 0.5) {
      anomalies.push({
        type: 'low_avg_score',
        description: `Average similarity score is ${(avgScore * 100).toFixed(0)}% — below the 50% quality threshold. Results may not be relevant.`,
        severity: avgScore <= 0.3 ? 'critical' : 'warning',
      });
    }

    const now = new Date();
    const allStale = results.every((r) => {
      const ageDays = (now.getTime() - r.entity.lastModified.getTime()) / MS_PER_DAY;
      return ageDays >= STALE_DAYS;
    });
    if (allStale && results.length > 0) {
      anomalies.push({
        type: 'all_stale',
        description: `All retrieved entities are older than ${STALE_DAYS} days. Context may be outdated — consider triggering a sync.`,
        severity: 'info',
      });
    }

    return anomalies;
  }

  /**
   * Suggest entities reachable via relationships that were not in the current results.
   * These can expand context quality without re-running the full query.
   *
   * @param results - Current retrieval results
   */
  suggestContextExpansion(results: VectorSearchResult[]): ExpansionSuggestion[] {
    const retrievedIds = new Set(results.map((r) => r.entity.id));
    const suggestions: ExpansionSuggestion[] = [];
    const seen = new Set<string>();

    for (const r of results) {
      for (const rel of r.entity.relationships) {
        if (retrievedIds.has(rel.targetId)) continue;
        if (seen.has(rel.targetId)) continue;
        seen.add(rel.targetId);

        suggestions.push({
          entityId: rel.targetId,
          label: rel.targetId,
          type: rel.targetId.split(':')[1] ?? 'unknown',
          relationshipType: rel.type,
          sourceEntityId: r.entity.id,
        });
      }
    }

    return suggestions.slice(0, 10);
  }
}
