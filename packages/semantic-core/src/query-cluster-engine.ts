import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-cluster-engine' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type QueryCluster = {
  clusterId: string;
  workspaceId: string;
  clusterSignature: string;
  memberCount: number;
  dominantEntityTypes: string[];
  updateFrequencyPercentile: number;
  optimalTtlSeconds: number;
  confidenceScore: number;
  createdAt: Date;
};

export type QueryMembership = {
  queryHash: string;
  clusterId: string;
  similarityScore: number;
};

export type CacheInvalidationEvent = {
  workspaceId: string;
  triggerEntityType: string;
  affectedClusters: string[];
  cascadeDepth: number;
  occurredAt: Date;
};

export type ClusterSignature = {
  dominantEntityTypes: string[];
  queryIntent: 'analytical' | 'operational' | 'reporting' | 'synthesis';
  updateFrequencyPercentile: number;
  avgEmbeddingCentroid: number[];
};

export type AdaptiveTtlAssignment = {
  queryHash: string;
  clusterId: string | null;
  ttlSeconds: number;
  strategy: 'stable_reference' | 'high_velocity' | 'default' | 'new_query';
  similarityScore: number;
};

/** TTL strategies based on update frequency percentile. */
const TTL_STRATEGY = {
  STABLE_REFERENCE: 86400,   // 24h — stable, rarely updated data
  MODERATE: 3600,             // 1h  — moderate change rate
  HIGH_VELOCITY: 300,         // 5min — frequently changing data
  DEFAULT: 900,               // 15min — fallback
} as const;

const CLUSTER_ASSIGNMENT_THRESHOLD = 0.72;

/**
 * Compute centroid of an array of equal-length vectors.
 * @param vectors - List of embedding vectors
 */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) centroid[i]! += vec[i]!;
  }
  for (let i = 0; i < dim; i++) centroid[i]! /= vectors.length;
  return centroid;
}

/**
 * Cosine similarity between two vectors.
 * @param a - First vector
 * @param b - Second vector
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Run k-means clustering on query embeddings.
 * @param embeddings - Array of {queryHash, vector} objects
 * @param k - Number of clusters
 * @param maxIterations - Max k-means iterations
 */
export function kMeansCluster(
  embeddings: Array<{ queryHash: string; vector: number[] }>,
  k: number,
  maxIterations = 50,
): Array<{ queryHash: string; clusterId: number; similarity: number }> {
  if (embeddings.length === 0 || k <= 0) return [];

  const clampedK = Math.min(k, embeddings.length);

  // Initialize centroids by picking evenly-spaced indices
  const step = Math.max(1, Math.floor(embeddings.length / clampedK));
  let centroids = Array.from({ length: clampedK }, (_, i) =>
    embeddings[(i * step) % embeddings.length]!.vector.slice(),
  );

  let assignments = new Array<number>(embeddings.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    let changed = false;
    for (let i = 0; i < embeddings.length; i++) {
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < clampedK; c++) {
        const sim = cosineSimilarity(embeddings[i]!.vector, centroids[c]!);
        if (sim > bestSim) { bestSim = sim; bestCluster = c; }
      }
      if (assignments[i] !== bestCluster) { assignments[i] = bestCluster; changed = true; }
    }
    if (!changed) break;

    // Recompute centroids
    const groups = Array.from({ length: clampedK }, () => [] as number[][]);
    for (let i = 0; i < embeddings.length; i++) {
      groups[assignments[i]!]!.push(embeddings[i]!.vector);
    }
    centroids = groups.map((g, idx) => g.length > 0 ? computeCentroid(g) : centroids[idx]!);
  }

  return embeddings.map((e, i) => ({
    queryHash: e.queryHash,
    clusterId: assignments[i]!,
    similarity: cosineSimilarity(e.vector, centroids[assignments[i]!]!),
  }));
}

/**
 * Extract a cluster signature from grouped query membership rows.
 * @param entityTypes - All entity types mentioned in cluster queries
 * @param updateFrequencies - Update frequency values (0-100 percentile) for cluster queries
 * @param centroid - Embedding centroid for the cluster
 */
export function extractClusterSignature(
  entityTypes: string[],
  updateFrequencies: number[],
  centroid: number[],
): ClusterSignature {
  // Count entity type occurrences and pick top 3
  const typeCounts = new Map<string, number>();
  for (const t of entityTypes) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  const dominantEntityTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  // Median update frequency percentile
  const sorted = [...updateFrequencies].sort((a, b) => a - b);
  const updateFrequencyPercentile = sorted[Math.floor(sorted.length / 2)] ?? 50;

  // Infer intent from dominant entity types
  let queryIntent: ClusterSignature['queryIntent'] = 'operational';
  if (dominantEntityTypes.includes('metric')) queryIntent = 'analytical';
  else if (dominantEntityTypes.includes('report')) queryIntent = 'reporting';
  else if (dominantEntityTypes.length >= 3) queryIntent = 'synthesis';

  return { dominantEntityTypes, queryIntent, updateFrequencyPercentile, avgEmbeddingCentroid: centroid };
}

/**
 * Predict optimal cache TTL seconds for a cluster based on data velocity.
 * @param updateFrequencyPercentile - How often data in this cluster changes (0-100)
 * @param queryIntent - Cluster query intent
 */
export function predictOptimalCacheTtl(
  updateFrequencyPercentile: number,
  queryIntent: ClusterSignature['queryIntent'],
): { ttlSeconds: number; strategy: AdaptiveTtlAssignment['strategy'] } {
  // Reporting/analytical queries tolerate slightly stale data
  const velocityAdjusted = queryIntent === 'analytical' || queryIntent === 'reporting'
    ? updateFrequencyPercentile * 0.8
    : updateFrequencyPercentile;

  if (velocityAdjusted < 20) {
    return { ttlSeconds: TTL_STRATEGY.STABLE_REFERENCE, strategy: 'stable_reference' };
  } else if (velocityAdjusted < 60) {
    return { ttlSeconds: TTL_STRATEGY.MODERATE, strategy: 'default' };
  } else {
    return { ttlSeconds: TTL_STRATEGY.HIGH_VELOCITY, strategy: 'high_velocity' };
  }
}

/**
 * Cluster queries by semantic similarity using query embeddings from the DB.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param days - Lookback window
 */
export async function clusterQueriesBySemanticSimilarity(
  sql: SqlFn,
  workspaceId: string,
  days = 7,
): Promise<Result<QueryCluster[], Error>> {
  try {
    const since = new Date(Date.now() - days * 86_400_000);

    // Load query hashes + embeddings
    const rows = await sql`
      SELECT query_hash, embedding_vector, entity_types_accessed, executed_at
      FROM query_analytics
      WHERE workspace_id = ${workspaceId}
        AND executed_at >= ${since}
        AND embedding_vector IS NOT NULL
      ORDER BY executed_at DESC
      LIMIT 2000
    ` as unknown as Array<{
      query_hash: string;
      embedding_vector: number[];
      entity_types_accessed: string[];
      executed_at: string;
    }>;

    if (rows.length === 0) return ok([]);

    const k = Math.min(50, Math.max(10, Math.floor(Math.sqrt(rows.length))));
    const embeddings = rows.map(r => ({ queryHash: r.query_hash, vector: r.embedding_vector }));
    const assignments = kMeansCluster(embeddings, k);

    // Group by cluster
    type ClusterAccum = {
      queryHashes: string[];
      entityTypes: string[];
      vectors: number[][];
    };
    const groups = new Map<number, ClusterAccum>();
    for (const a of assignments) {
      const g = groups.get(a.clusterId) ?? { queryHashes: [], entityTypes: [], vectors: [] };
      g.queryHashes.push(a.queryHash);
      const row = rows.find(r => r.query_hash === a.queryHash);
      if (row) {
        g.entityTypes.push(...(row.entity_types_accessed ?? []));
        g.vectors.push(row.embedding_vector);
      }
      groups.set(a.clusterId, g);
    }

    // Build QueryCluster records
    const clusters: QueryCluster[] = [];
    for (const [clusterId, g] of groups) {
      if (g.queryHashes.length === 0) continue;
      const centroid = computeCentroid(g.vectors);

      // Compute update frequency percentile from assigned rows
      const updateFrequencies = g.queryHashes.map((_, idx) => Math.min(100, idx * 2)); // placeholder
      const sig = extractClusterSignature(g.entityTypes, updateFrequencies, centroid);
      const { ttlSeconds } = predictOptimalCacheTtl(sig.updateFrequencyPercentile, sig.queryIntent);

      clusters.push({
        clusterId: `${workspaceId}-cluster-${clusterId}`,
        workspaceId,
        clusterSignature: JSON.stringify({ entityTypes: sig.dominantEntityTypes, intent: sig.queryIntent }),
        memberCount: g.queryHashes.length,
        dominantEntityTypes: sig.dominantEntityTypes,
        updateFrequencyPercentile: sig.updateFrequencyPercentile,
        optimalTtlSeconds: ttlSeconds,
        confidenceScore: Math.min(1, g.queryHashes.length / Math.max(1, rows.length / k)),
        createdAt: new Date(),
      });
    }

    log.info('Query clustering complete', { workspaceId, clusterCount: clusters.length, queryCount: rows.length });
    return ok(clusters);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Assign adaptive TTL to a query by finding its nearest cluster.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param queryHash - Query to assign TTL to
 * @param queryEmbedding - Query embedding vector
 */
export async function adaptiveTtlAssignment(
  sql: SqlFn,
  workspaceId: string,
  queryHash: string,
  queryEmbedding: number[],
): Promise<Result<AdaptiveTtlAssignment, Error>> {
  try {
    const rows = await sql`
      SELECT cluster_id, cluster_signature, optimal_ttl_seconds, update_frequency_percentile
      FROM query_clusters
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT 100
    ` as unknown as Array<{
      cluster_id: string;
      cluster_signature: string;
      optimal_ttl_seconds: number;
      update_frequency_percentile: number;
    }>;

    if (rows.length === 0) {
      return ok({
        queryHash,
        clusterId: null,
        ttlSeconds: TTL_STRATEGY.DEFAULT,
        strategy: 'new_query',
        similarityScore: 0,
      });
    }

    // Parse cluster centroids from memberships or use frequency-based assignment
    let bestCluster: (typeof rows)[0] | null = null;
    let bestSim = -Infinity;

    for (const row of rows) {
      let sig: { centroid?: number[] } = {};
      try { sig = JSON.parse(row.cluster_signature); } catch { /* ignore */ }
      const sim = sig.centroid ? cosineSimilarity(queryEmbedding, sig.centroid) : 0.5;
      if (sim > bestSim) { bestSim = sim; bestCluster = row; }
    }

    if (!bestCluster || bestSim < CLUSTER_ASSIGNMENT_THRESHOLD) {
      return ok({
        queryHash,
        clusterId: null,
        ttlSeconds: TTL_STRATEGY.DEFAULT,
        strategy: 'new_query',
        similarityScore: bestSim,
      });
    }

    const intent: ClusterSignature['queryIntent'] = 'operational';
    const { ttlSeconds, strategy } = predictOptimalCacheTtl(bestCluster.update_frequency_percentile, intent);

    return ok({
      queryHash,
      clusterId: bestCluster.cluster_id,
      ttlSeconds,
      strategy,
      similarityScore: Math.round(bestSim * 1000) / 1000,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Detect which clusters are affected by an entity type update (cascade invalidation).
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param triggerEntityType - Entity type that was updated
 */
export async function detectCacheInvalidationPatterns(
  sql: SqlFn,
  workspaceId: string,
  triggerEntityType: string,
): Promise<Result<CacheInvalidationEvent, Error>> {
  try {
    const rows = await sql`
      SELECT cluster_id
      FROM query_clusters
      WHERE workspace_id = ${workspaceId}
        AND ${triggerEntityType} = ANY(dominant_entity_types)
    ` as unknown as Array<{ cluster_id: string }>;

    const affectedClusters = rows.map(r => r.cluster_id);

    // Cascade: also find clusters that reference the affected clusters' entity types
    const cascadeRows = affectedClusters.length > 0 ? await sql`
      SELECT DISTINCT cluster_id
      FROM query_clusters
      WHERE workspace_id = ${workspaceId}
        AND cluster_id != ALL(${affectedClusters})
        AND dominant_entity_types && (
          SELECT array_agg(DISTINCT unnested)
          FROM query_clusters qc, unnest(dominant_entity_types) AS unnested
          WHERE qc.workspace_id = ${workspaceId}
            AND qc.cluster_id = ANY(${affectedClusters})
        )
    ` as unknown as Array<{ cluster_id: string }> : [];

    const allAffected = [...affectedClusters, ...cascadeRows.map(r => r.cluster_id)];
    const cascadeDepth = cascadeRows.length > 0 ? 2 : affectedClusters.length > 0 ? 1 : 0;

    await sql`
      INSERT INTO cache_invalidation_events (workspace_id, trigger_entity_type, affected_clusters, cascade_depth, occurred_at)
      VALUES (${workspaceId}, ${triggerEntityType}, ${allAffected}, ${cascadeDepth}, NOW())
    `;

    return ok({
      workspaceId,
      triggerEntityType,
      affectedClusters: allAffected,
      cascadeDepth,
      occurredAt: new Date(),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Persist computed cluster results to the DB.
 * @param sql - SQL function
 * @param clusters - Clusters to upsert
 * @param memberships - Query-cluster memberships to upsert
 */
export async function persistClusters(
  sql: SqlFn,
  clusters: QueryCluster[],
  memberships: QueryMembership[],
): Promise<Result<void, Error>> {
  try {
    for (const c of clusters) {
      await sql`
        INSERT INTO query_clusters (
          workspace_id, cluster_id, cluster_signature, member_count,
          dominant_entity_types, update_frequency_percentile, optimal_ttl_seconds,
          confidence_score, created_at
        ) VALUES (
          ${c.workspaceId}, ${c.clusterId}, ${c.clusterSignature}, ${c.memberCount},
          ${c.dominantEntityTypes}, ${c.updateFrequencyPercentile}, ${c.optimalTtlSeconds},
          ${c.confidenceScore}, ${c.createdAt}
        )
        ON CONFLICT (workspace_id, cluster_id) DO UPDATE SET
          member_count = EXCLUDED.member_count,
          dominant_entity_types = EXCLUDED.dominant_entity_types,
          optimal_ttl_seconds = EXCLUDED.optimal_ttl_seconds,
          confidence_score = EXCLUDED.confidence_score
      `;
    }

    for (const m of memberships) {
      await sql`
        INSERT INTO query_membership (query_hash, cluster_id, similarity_score)
        VALUES (${m.queryHash}, ${m.clusterId}, ${m.similarityScore})
        ON CONFLICT (query_hash, cluster_id) DO UPDATE SET
          similarity_score = EXCLUDED.similarity_score
      `;
    }

    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
