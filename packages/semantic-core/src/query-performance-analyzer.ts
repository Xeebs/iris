import { createHash } from 'crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-performance-analyzer' });

export type QueryMetrics = {
  executionTimeMs: number;
  embeddingTimeMs?: number;
  vectorSearchTimeMs?: number;
  graphExpansionTimeMs?: number;
  compressionTimeMs?: number;
  resultSize?: number;
};

export type QueryRecord = QueryMetrics & {
  workspaceId: string;
  queryHash: string;
  queryText?: string;
  timestamp: Date;
};

export type SlowQuery = {
  queryHash: string;
  queryText: string | null;
  p50Ms: number;
  p95Ms: number;
  callCount: number;
  avgResultSize: number | null;
};

export type EntityAccessEntry = {
  entityId: string;
  accessCount: number;
  lastAccessed: Date;
};

export type IndexRecommendation = {
  type: 'partial_index' | 'bloom_filter' | 'ann_tuning' | 'ivfflat_lists';
  priority: 'high' | 'medium' | 'low';
  description: string;
  estimatedImpact: string;
  sqlHint?: string;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/**
 * Records and analyzes query performance metrics for a workspace.
 * Identifies slow queries and recommends vector index improvements.
 */
export class QueryPerformanceAnalyzer {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Persists per-request query metrics. Call after every MCP query.
   *
   * @param workspaceId - Tenant workspace
   * @param queryText - Raw query string (hashed for grouping)
   * @param metrics - Execution breakdown in milliseconds
   */
  async logQueryMetrics(
    workspaceId: string,
    queryText: string,
    metrics: QueryMetrics,
  ): Promise<Result<void, Error>> {
    const queryHash = createHash('sha256').update(queryText).digest('hex').slice(0, 16);
    const metricsJson = JSON.stringify(metrics);
    try {
      await this.sql`
        INSERT INTO query_performance (
          workspace_id, query_hash, query_text, execution_time_ms,
          embedding_time_ms, vector_search_time_ms, graph_expansion_time_ms,
          compression_time_ms, result_size, metrics_json
        ) VALUES (
          ${workspaceId}, ${queryHash}, ${queryText},
          ${metrics.executionTimeMs},
          ${metrics.embeddingTimeMs ?? null},
          ${metrics.vectorSearchTimeMs ?? null},
          ${metrics.graphExpansionTimeMs ?? null},
          ${metrics.compressionTimeMs ?? null},
          ${metrics.resultSize ?? null},
          ${metricsJson}
        )
      `;
      log.debug('Query metrics logged', { workspaceId, queryHash, executionTimeMs: metrics.executionTimeMs });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns the top slow queries (p95 > 1s) grouped by query hash.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Maximum number of slow queries to return
   * @param days - Lookback window in days
   * @returns Sorted list of slow queries with p50/p95 latencies
   */
  async analyzeSlowQueries(workspaceId: string, limit = 10, days = 7): Promise<Result<SlowQuery[], Error>> {
    try {
      const rows = await this.sql`
        SELECT
          query_hash,
          MAX(query_text) AS query_text,
          COUNT(*) AS call_count,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY execution_time_ms)::int AS p50_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms)::int AS p95_ms,
          AVG(result_size)::int AS avg_result_size
        FROM query_performance
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - (${days} || ' days')::interval
        GROUP BY query_hash
        HAVING PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) > 1000
        ORDER BY p95_ms DESC
        LIMIT ${limit}
      ` as {
        query_hash: string;
        query_text: string | null;
        call_count: string;
        p50_ms: number;
        p95_ms: number;
        avg_result_size: number | null;
      }[];

      return ok(rows.map((r) => ({
        queryHash: r.query_hash,
        queryText: r.query_text,
        p50Ms: r.p50_ms,
        p95Ms: r.p95_ms,
        callCount: Number(r.call_count),
        avgResultSize: r.avg_result_size,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns entity access frequency heatmap data for the workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Maximum entity count to return
   * @param days - Lookback window in days
   */
  async analyzeQueryPatterns(workspaceId: string, limit = 50, days = 7): Promise<Result<EntityAccessEntry[], Error>> {
    try {
      const rows = await this.sql`
        SELECT
          entity_id,
          COUNT(*) AS access_count,
          MAX(timestamp) AS last_accessed
        FROM entity_access_log
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - (${days} || ' days')::interval
        GROUP BY entity_id
        ORDER BY access_count DESC
        LIMIT ${limit}
      ` as { entity_id: string; access_count: string; last_accessed: Date }[];

      return ok(rows.map((r) => ({
        entityId: r.entity_id,
        accessCount: Number(r.access_count),
        lastAccessed: new Date(r.last_accessed),
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generates vector index optimization recommendations based on entity count
   * and recent query latency patterns.
   *
   * @param workspaceId - Tenant workspace
   * @returns Prioritized list of index improvement recommendations
   */
  async optimizeVectorIndex(workspaceId: string): Promise<Result<IndexRecommendation[], Error>> {
    try {
      const statsRows = await this.sql`
        SELECT
          COUNT(*)::int AS entity_count
        FROM semantic_entities
        WHERE workspace_id = ${workspaceId}
      ` as { entity_count: number }[];

      const latencyRows = await this.sql`
        SELECT
          AVG(vector_search_time_ms)::int AS avg_vs_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY vector_search_time_ms)::int AS p95_vs_ms
        FROM query_performance
        WHERE workspace_id = ${workspaceId}
          AND vector_search_time_ms IS NOT NULL
          AND timestamp >= now() - INTERVAL '7 days'
      ` as { avg_vs_ms: number | null; p95_vs_ms: number | null }[];

      const entityCount = statsRows[0]?.entity_count ?? 0;
      const p95VsMs = latencyRows[0]?.p95_vs_ms ?? 0;

      const recs: IndexRecommendation[] = [];

      if (entityCount > 100_000) {
        recs.push({
          type: 'ivfflat_lists',
          priority: 'high',
          description: 'Increase IVFFlat list count for large entity set',
          estimatedImpact: '30–50% reduction in vector search latency',
          sqlHint: `CREATE INDEX CONCURRENTLY ON entity_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${Math.round(Math.sqrt(entityCount))});`,
        });
      }

      if (p95VsMs > 500) {
        recs.push({
          type: 'ann_tuning',
          priority: 'high',
          description: 'Vector search p95 exceeds 500ms — tune probes or switch to HNSW',
          estimatedImpact: '40–60% latency reduction with HNSW index',
          sqlHint: 'CREATE INDEX ON entity_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);',
        });
      }

      if (entityCount > 10_000 && entityCount <= 100_000) {
        recs.push({
          type: 'partial_index',
          priority: 'medium',
          description: 'Build partial indexes per entity type to speed up filtered searches',
          estimatedImpact: '20–35% reduction on type-filtered queries',
          sqlHint: "CREATE INDEX ON entity_embeddings (workspace_id, entity_type) WHERE entity_type = 'contact';",
        });
      }

      if (entityCount > 50_000) {
        recs.push({
          type: 'bloom_filter',
          priority: 'low',
          description: 'Add bloom filter index on entity labels for fast exact-match pre-filtering',
          estimatedImpact: 'Eliminates unnecessary ANN scans for exact matches',
          sqlHint: 'CREATE INDEX ON semantic_entities USING bloom (label) WITH (length = 80, col1 = 2);',
        });
      }

      if (recs.length === 0) {
        recs.push({
          type: 'partial_index',
          priority: 'low',
          description: 'Index configuration looks healthy — no urgent changes needed',
          estimatedImpact: 'None',
        });
      }

      return ok(recs);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
