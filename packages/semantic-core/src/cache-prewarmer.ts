import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'cache-prewarmer' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type CoOccurrencePattern = {
  entityTypeA: string;
  entityTypeB: string;
  coOccurrenceScore: number;
  timeOfDayBias: number[];
};

export type PredictedContext = {
  entityIds: string[];
  entityTypes: string[];
  confidenceScore: number;
  predictedAt: Date;
  ttlSeconds: number;
};

export type PrewarmResult = {
  entityIds: string[];
  loadedCount: number;
  ttlSeconds: number;
  warmedAt: Date;
};

export type CacheWarmingStats = {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  totalPredictions: number;
  cacheHitsFromWarming: number;
  accuracyRatio: number;
  avgLatencyImprovementMs: number;
};

/** Hours in a day bucketed by business relevance (0=off, 1=low, 2=medium, 3=high). */
const HOUR_BUSINESS_WEIGHT = [
  0, 0, 0, 0, 0, 0, 0, // 0-6am
  1, 2, 3, 3, 3, 2, // 7-12pm
  3, 3, 3, 2, 2, 1, // 1-6pm
  0, 0, 0, 0, 0, // 7-11pm
];

/**
 * Compute the current hour's business weight (0-3).
 * Used to weight cache warming priority by time-of-day.
 */
function currentHourWeight(): number {
  const hour = new Date().getUTCHours();
  return HOUR_BUSINESS_WEIGHT[hour] ?? 0;
}

/**
 * Analyze query patterns for a workspace to find entity types frequently queried together.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param days - Lookback window in days
 * @returns Co-occurrence patterns sorted by score descending
 */
export async function analyzeQueryPatterns(
  sql: SqlFn,
  workspaceId: string,
  days = 7,
): Promise<Result<CoOccurrencePattern[], Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);

    // Pull query patterns from the learning engine table
    const rows = await sql`
      SELECT entity_types_queried, occurrences, filters_used
      FROM query_patterns
      WHERE workspace_id = ${workspaceId}
        AND created_at >= ${since}
      ORDER BY occurrences DESC
      LIMIT 200
    ` as unknown as Array<{
      entity_types_queried: string | string[];
      occurrences: number;
      filters_used: string | null;
    }>;

    // Build a co-occurrence matrix
    const coMatrix = new Map<string, number>();
    let totalOccurrences = 0;

    for (const row of rows) {
      const types = Array.isArray(row.entity_types_queried)
        ? row.entity_types_queried
        : JSON.parse(row.entity_types_queried as string) as string[];
      const count = row.occurrences;
      totalOccurrences += count;

      for (let i = 0; i < types.length; i++) {
        for (let j = i + 1; j < types.length; j++) {
          const key = [types[i], types[j]].sort().join(':');
          coMatrix.set(key, (coMatrix.get(key) ?? 0) + count);
        }
        // Self co-occurrence for high-frequency singles
        const selfKey = `${types[i]}:${types[i]}`;
        coMatrix.set(selfKey, (coMatrix.get(selfKey) ?? 0) + count);
      }
    }

    const patterns: CoOccurrencePattern[] = [];
    for (const [key, count] of coMatrix.entries()) {
      const [a, b] = key.split(':') as [string, string];
      const score = totalOccurrences > 0 ? count / totalOccurrences : 0;
      if (score < 0.03) continue; // Filter below 3% threshold

      patterns.push({
        entityTypeA: a,
        entityTypeB: b,
        coOccurrenceScore: Math.round(score * 1000) / 1000,
        timeOfDayBias: HOUR_BUSINESS_WEIGHT.slice(),
      });
    }

    patterns.sort((a, b) => b.coOccurrenceScore - a.coOccurrenceScore);
    log.info('Query pattern analysis complete', { workspaceId, patterns: patterns.length });
    return ok(patterns.slice(0, 20));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Predict entity IDs likely to be queried next, given a current query context.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param currentQuery - The query that just ran
 * @param currentEntityIds - Entity IDs in the current result set
 */
export async function predictNextContext(
  sql: SqlFn,
  workspaceId: string,
  currentQuery: string,
  currentEntityIds: string[] = [],
): Promise<Result<PredictedContext, Error>> {
  try {
    // Find related entities via relationship edges
    const relatedRows = currentEntityIds.length > 0
      ? await sql`
          SELECT DISTINCT target_id AS entity_id, relationship_type
          FROM entity_relationships
          WHERE workspace_id = ${workspaceId}
            AND source_id = ANY(${currentEntityIds})
          LIMIT 50
        ` as unknown as Array<{ entity_id: string; relationship_type: string }>
      : [];

    // Also find entities that co-occur frequently with the query's entity types
    const lq = currentQuery.toLowerCase();
    const queriedType = lq.includes('contact') ? 'contact'
      : lq.includes('deal') ? 'deal'
      : lq.includes('company') ? 'company'
      : lq.includes('ticket') ? 'ticket'
      : null;

    let typeRelatedRows: Array<{ entity_id: string }> = [];
    if (queriedType) {
      typeRelatedRows = await sql`
        SELECT id AS entity_id
        FROM entities
        WHERE workspace_id = ${workspaceId}
          AND entity_type = ${queriedType}
        ORDER BY last_modified DESC NULLS LAST
        LIMIT 20
      ` as unknown as Array<{ entity_id: string }>;
    }

    const allPredicted = [
      ...relatedRows.map(r => r.entity_id),
      ...typeRelatedRows.map(r => r.entity_id),
    ];
    const unique = [...new Set(allPredicted)].slice(0, 30);

    const hourWeight = currentHourWeight();
    const confidence = hourWeight > 0
      ? Math.min(0.9, 0.3 + unique.length * 0.015 + hourWeight * 0.1)
      : 0.2;

    const ttlSeconds = hourWeight > 1 ? 300 : 120; // 5min during business hours, 2min off-hours

    return ok({
      entityIds: unique,
      entityTypes: queriedType ? [queriedType] : [],
      confidenceScore: confidence,
      predictedAt: new Date(),
      ttlSeconds,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Preload predicted entities into the cache (simulate cache warming by recording IDs).
 * In production this would call the SemanticCache to pre-populate embeddings.
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param entityIds - Entity IDs to prewarm
 * @param ttlSeconds - Cache TTL for prewarmed entries
 */
export async function preloadToCache(
  sql: SqlFn,
  workspaceId: string,
  entityIds: string[],
  ttlSeconds = 300,
): Promise<Result<PrewarmResult, Error>> {
  try {
    if (entityIds.length === 0) {
      return ok({ entityIds: [], loadedCount: 0, ttlSeconds, warmedAt: new Date() });
    }

    // Fetch entity data to warm the cache
    const rows = await sql`
      SELECT id, entity_type, label, attributes
      FROM entities
      WHERE workspace_id = ${workspaceId}
        AND id = ANY(${entityIds})
      LIMIT 100
    ` as unknown as Array<{ id: string }>;

    const loadedIds = rows.map(r => r.id);

    // Record warming event for stats tracking
    await sql`
      INSERT INTO cache_prewarming_stats
        (workspace_id, predicted_entity_ids, loaded_count, measured_at)
      VALUES (
        ${workspaceId}, ${JSON.stringify(loadedIds)},
        ${loadedIds.length}, NOW()
      )
    `;

    log.info('Cache prewarmed', { workspaceId, requested: entityIds.length, loaded: loadedIds.length, ttlSeconds });
    return ok({
      entityIds: loadedIds,
      loadedCount: loadedIds.length,
      ttlSeconds,
      warmedAt: new Date(),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Measure how often prewarmed cache entries are actually hit (effectiveness tracking).
 * @param sql - SQL function
 * @param workspaceId - Target workspace
 * @param days - Measurement window
 */
export async function measurePrefixCacheHits(
  sql: SqlFn,
  workspaceId: string,
  days = 7,
): Promise<Result<CacheWarmingStats, Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await sql`
      SELECT
        SUM(loaded_count)          AS total_loaded,
        SUM(actual_cache_hit_count) AS total_hits,
        COUNT(*)                   AS total_predictions,
        MIN(measured_at)           AS period_start,
        MAX(measured_at)           AS period_end
      FROM cache_prewarming_stats
      WHERE workspace_id = ${workspaceId}
        AND measured_at >= ${since}
    ` as unknown as Array<{
      total_loaded: string | null;
      total_hits: string | null;
      total_predictions: string;
      period_start: string | null;
      period_end: string | null;
    }>;

    const row = rows[0] ?? { total_loaded: '0', total_hits: '0', total_predictions: '0', period_start: null, period_end: null };
    const totalLoaded = parseInt(row.total_loaded ?? '0', 10);
    const totalHits = parseInt(row.total_hits ?? '0', 10);
    const totalPredictions = parseInt(row.total_predictions, 10);

    const accuracyRatio = totalLoaded > 0 ? totalHits / totalLoaded : 0;
    const latencyImprovement = accuracyRatio > 0.5 ? Math.round(accuracyRatio * 150) : 0;

    return ok({
      workspaceId,
      periodStart: row.period_start ? new Date(row.period_start) : since,
      periodEnd: row.period_end ? new Date(row.period_end) : new Date(),
      totalPredictions,
      cacheHitsFromWarming: totalHits,
      accuracyRatio: Math.round(accuracyRatio * 100) / 100,
      avgLatencyImprovementMs: latencyImprovement,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
