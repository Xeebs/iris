import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'batch-recommender' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityContext = {
  entityId: string;
  entityType: string;
  label: string;
  relevanceScore: number;
  sharedWith: string[];
};

export type PerEntityRecommendation = {
  entityId: string;
  contexts: EntityContext[];
  topAttributes: string[];
};

export type SharedContext = {
  contextId: string;
  entityIds: string[];
  relevanceScore: number;
  description: string;
};

export type BatchRecommendationResult = {
  sessionId: string;
  perEntity: PerEntityRecommendation[];
  sharedContexts: SharedContext[];
  generatedAt: Date;
};

export type GroupCharacteristic = {
  attribute: string;
  commonValue: string | null;
  coverage: number;
  divergent: boolean;
};

export type GroupAnalysis = {
  entityIds: string[];
  commonTypes: string[];
  characteristics: GroupCharacteristic[];
  gaps: string[];
  relationshipDensity: number;
};

export type GroupAction = {
  action: 'bulk_link' | 'bulk_tag' | 'bulk_update_attribute' | 'review_duplicates';
  affectedEntityIds: string[];
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

export type GroupScoreResult = {
  metric: string;
  mean: number;
  variance: number;
  min: number;
  max: number;
  trend: 'up' | 'down' | 'stable';
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute aggregate statistics for a set of numeric scores.
 * @param scores - Individual entity scores
 * @returns Mean, variance, min, max, and trend indicator
 */
export function computeAggregateStats(scores: number[]): { mean: number; variance: number; min: number; max: number } {
  if (scores.length === 0) return { mean: 0, variance: 0, min: 0, max: 0 };
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length;
  return { mean, variance, min: Math.min(...scores), max: Math.max(...scores) };
}

/**
 * Detect trend direction from ordered score series.
 * Uses linear regression slope to classify up/down/stable.
 * @param scores - Scores in chronological order
 * @returns Trend direction
 */
export function detectTrend(scores: number[]): 'up' | 'down' | 'stable' {
  if (scores.length < 2) return 'stable';
  const n = scores.length;
  const xMean = (n - 1) / 2;
  const yMean = scores.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (scores[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 'stable';
  const slope = num / den;
  if (slope > 0.01) return 'up';
  if (slope < -0.01) return 'down';
  return 'stable';
}

/**
 * Find contexts that appear across multiple entities (shared contexts).
 * @param perEntityContextIds - Map from entityId to context IDs
 * @param minShared - Minimum number of entities a context must appear in
 * @returns List of shared context IDs with entity membership
 */
export function findSharedContextIds(
  perEntityContextIds: Map<string, string[]>,
  minShared = 2,
): { contextId: string; entityIds: string[] }[] {
  const contextToEntities = new Map<string, string[]>();
  for (const [entityId, ids] of perEntityContextIds) {
    for (const id of ids) {
      const existing = contextToEntities.get(id) ?? [];
      existing.push(entityId);
      contextToEntities.set(id, existing);
    }
  }
  const shared: { contextId: string; entityIds: string[] }[] = [];
  for (const [contextId, entityIds] of contextToEntities) {
    if (entityIds.length >= minShared) {
      shared.push({ contextId, entityIds });
    }
  }
  return shared.sort((a, b) => b.entityIds.length - a.entityIds.length);
}

/**
 * Compute attribute coverage across a list of entity records.
 * @param entities - List of entity attribute maps
 * @param attribute - Attribute name to evaluate
 * @returns Coverage fraction (0-1) and whether values diverge
 */
export function computeAttributeCoverage(
  entities: Record<string, unknown>[],
  attribute: string,
): { coverage: number; commonValue: string | null; divergent: boolean } {
  if (entities.length === 0) return { coverage: 0, commonValue: null, divergent: false };
  const values = entities.map((e) => e[attribute]).filter((v) => v !== null && v !== undefined);
  const coverage = values.length / entities.length;
  if (values.length === 0) return { coverage: 0, commonValue: null, divergent: false };
  const unique = new Set(values.map(String));
  const commonValue = unique.size === 1 ? String(values[0]) : null;
  return { coverage, commonValue, divergent: unique.size > 1 };
}

// ─── BatchContextRecommender ──────────────────────────────────────────────────

export class BatchContextRecommender {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Recommend relevant contexts for a batch of entities, returning per-entity
   * contexts and deduplication-derived shared contexts.
   * @param entityIds - Target entity IDs
   * @param topK - Max contexts per entity
   * @returns Per-entity recommendations and shared contexts
   */
  async recommendContextForEntities(
    entityIds: string[],
    topK = 10,
  ): Promise<Result<BatchRecommendationResult, Error>> {
    if (entityIds.length === 0) return err(new Error('entityIds must not be empty'));
    try {
      type EntityRow = { id: string; type: string; label: string };
      const entities = await this.sql<EntityRow[]>`
        SELECT id, type, label FROM iris_entities WHERE id = ANY(${entityIds}::text[])
      `;
      const entityMap = new Map(entities.map((e) => [e.id, e]));

      type CoRow = { entity_id: string; entity_type: string; context_entity_id: string; score: number };
      const coAccessRows = await this.sql<CoRow[]>`
        SELECT tcu1.entity_id, tcu1.entity_type,
               tcu2.entity_id AS context_entity_id,
               COUNT(*)::float / NULLIF(MAX(sub.cnt), 1) AS score
        FROM team_context_usage tcu1
        JOIN team_context_usage tcu2
          ON tcu1.team_id = tcu2.team_id
          AND tcu2.entity_id != tcu1.entity_id
        JOIN (
          SELECT entity_id, COUNT(*) AS cnt FROM team_context_usage GROUP BY entity_id
        ) sub ON sub.entity_id = tcu1.entity_id
        WHERE tcu1.entity_id = ANY(${entityIds}::text[])
        GROUP BY tcu1.entity_id, tcu1.entity_type, tcu2.entity_id
        ORDER BY score DESC
        LIMIT ${entityIds.length * topK}
      `;

      const contextsByEntity = new Map<string, EntityContext[]>();
      for (const eid of entityIds) contextsByEntity.set(eid, []);

      const perEntityContextIds = new Map<string, string[]>();
      for (const row of coAccessRows) {
        const list = contextsByEntity.get(row.entity_id) ?? [];
        if (list.length >= topK) continue;
        list.push({
          entityId: row.context_entity_id,
          entityType: row.entity_type,
          label: row.context_entity_id,
          relevanceScore: row.score,
          sharedWith: [],
        });
        contextsByEntity.set(row.entity_id, list);
        const ids = perEntityContextIds.get(row.entity_id) ?? [];
        ids.push(row.context_entity_id);
        perEntityContextIds.set(row.entity_id, ids);
      }

      const sharedIds = findSharedContextIds(perEntityContextIds);
      const sharedContexts: SharedContext[] = sharedIds.map((s) => ({
        contextId: s.contextId,
        entityIds: s.entityIds,
        relevanceScore: s.entityIds.length / entityIds.length,
        description: `Shared by ${s.entityIds.length} of ${entityIds.length} entities`,
      }));

      const perEntity: PerEntityRecommendation[] = entityIds.map((eid) => ({
        entityId: eid,
        contexts: contextsByEntity.get(eid) ?? [],
        topAttributes: entityMap.get(eid) ? [entityMap.get(eid)!.type] : [],
      }));

      const sessionId = randomUUID();
      await this.sql`
        INSERT INTO batch_analysis_cache (id, entity_ids, result_json, created_at)
        VALUES (${sessionId}, ${JSON.stringify(entityIds)}, ${JSON.stringify({ perEntity, sharedContexts })}, NOW())
      `;

      log.info('Batch recommendations generated', { entityCount: entityIds.length, sharedContexts: sharedContexts.length });
      return ok({ sessionId, perEntity, sharedContexts, generatedAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Analyze a group of entities for common characteristics, gaps, and relationships.
   * @param entityIds - Group of entity IDs to analyze
   * @returns Group analysis with types, characteristics, gaps, and density
   */
  async analyzeEntityGroup(entityIds: string[]): Promise<Result<GroupAnalysis, Error>> {
    if (entityIds.length === 0) return err(new Error('entityIds must not be empty'));
    try {
      type EntityRow = { id: string; type: string; attributes: Record<string, unknown> };
      const entities = await this.sql<EntityRow[]>`
        SELECT id, type, attributes FROM iris_entities WHERE id = ANY(${entityIds}::text[])
      `;
      if (entities.length === 0) return err(new Error('No entities found for given IDs'));

      const typeFreq = new Map<string, number>();
      for (const e of entities) {
        typeFreq.set(e.type, (typeFreq.get(e.type) ?? 0) + 1);
      }
      const commonTypes = [...typeFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t);

      const allAttributes = new Set<string>();
      for (const e of entities) {
        for (const k of Object.keys(e.attributes ?? {})) allAttributes.add(k);
      }

      const characteristics: GroupCharacteristic[] = [...allAttributes].map((attr) => {
        const { coverage, commonValue, divergent } = computeAttributeCoverage(
          entities.map((e) => e.attributes ?? {}),
          attr,
        );
        return { attribute: attr, commonValue, coverage, divergent };
      });

      const gaps = characteristics
        .filter((c) => c.coverage < 0.5)
        .map((c) => c.attribute);

      type RelRow = { count: number };
      const [relRow] = await this.sql<RelRow[]>`
        SELECT COUNT(*)::int AS count FROM relationship_suggestions
        WHERE from_id = ANY(${entityIds}::text[]) AND to_id = ANY(${entityIds}::text[])
      `;
      const possiblePairs = entityIds.length * (entityIds.length - 1);
      const relationshipDensity = possiblePairs > 0 ? (relRow?.count ?? 0) / possiblePairs : 0;

      return ok({ entityIds, commonTypes, characteristics, gaps, relationshipDensity });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Recommend bulk actions for a group of entities based on shared characteristics.
   * @param entityIds - Group of entity IDs
   * @returns List of prioritized group actions
   */
  async suggestGroupActions(entityIds: string[]): Promise<Result<GroupAction[], Error>> {
    if (entityIds.length === 0) return err(new Error('entityIds must not be empty'));
    try {
      const analysisResult = await this.analyzeEntityGroup(entityIds);
      if (analysisResult.isErr()) return err(analysisResult.error);
      const analysis = analysisResult.value;

      const actions: GroupAction[] = [];

      if (analysis.relationshipDensity < 0.3 && entityIds.length > 1) {
        actions.push({
          action: 'bulk_link',
          affectedEntityIds: entityIds,
          reason: `Low relationship density (${Math.round(analysis.relationshipDensity * 100)}%) — consider linking related entities`,
          priority: 'high',
        });
      }

      if (analysis.gaps.length > 0) {
        actions.push({
          action: 'bulk_update_attribute',
          affectedEntityIds: entityIds,
          reason: `${analysis.gaps.length} attributes have <50% coverage: ${analysis.gaps.slice(0, 3).join(', ')}`,
          priority: analysis.gaps.length > 3 ? 'high' : 'medium',
        });
      }

      if (analysis.commonTypes.length > 1) {
        actions.push({
          action: 'bulk_tag',
          affectedEntityIds: entityIds,
          reason: `Mixed entity types (${analysis.commonTypes.join(', ')}) — consider tagging group for downstream filtering`,
          priority: 'low',
        });
      }

      const divergentAttrs = analysis.characteristics.filter((c) => c.divergent && c.coverage > 0.8);
      if (divergentAttrs.length > 0) {
        actions.push({
          action: 'review_duplicates',
          affectedEntityIds: entityIds,
          reason: `${divergentAttrs.length} highly-covered attributes diverge — possible duplicates`,
          priority: 'medium',
        });
      }

      return ok(actions);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute aggregated score metrics for a group of entities against a named metric.
   * @param entityIds - Group of entity IDs
   * @param metric - Metric name to evaluate (e.g., 'completeness', 'recency')
   * @returns Aggregated score statistics
   */
  async computeGroupScore(entityIds: string[], metric: string): Promise<Result<GroupScoreResult, Error>> {
    if (entityIds.length === 0) return err(new Error('entityIds must not be empty'));
    try {
      type ScoreRow = { entity_id: string; score: number; recorded_at: Date };
      const rows = await this.sql<ScoreRow[]>`
        SELECT entity_id, score, recorded_at FROM group_recommendations
        WHERE entity_id = ANY(${entityIds}::text[]) AND metric = ${metric}
        ORDER BY recorded_at DESC
      `;

      const latestByEntity = new Map<string, { score: number; recorded_at: Date }>();
      for (const row of rows) {
        if (!latestByEntity.has(row.entity_id)) {
          latestByEntity.set(row.entity_id, { score: row.score, recorded_at: row.recorded_at });
        }
      }

      const scores = [...latestByEntity.values()].map((r) => r.score);
      const chronological = rows.map((r) => r.score);
      const stats = computeAggregateStats(scores);
      const trend = detectTrend(chronological.slice(0, 20));

      return ok({ metric, ...stats, trend });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a previously computed batch analysis session.
   * @param sessionId - Session ID from a prior recommendContextForEntities call
   */
  async getSessionResult(sessionId: string): Promise<Result<BatchRecommendationResult, Error>> {
    try {
      type Row = { id: string; entity_ids: string; result_json: string; created_at: Date };
      const [row] = await this.sql<Row[]>`
        SELECT id, entity_ids, result_json, created_at FROM batch_analysis_cache WHERE id = ${sessionId}
      `;
      if (!row) return err(new Error(`Session ${sessionId} not found`));
      const parsed = JSON.parse(row.result_json) as { perEntity: PerEntityRecommendation[]; sharedContexts: SharedContext[] };
      return ok({ sessionId: row.id, ...parsed, generatedAt: row.created_at });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
