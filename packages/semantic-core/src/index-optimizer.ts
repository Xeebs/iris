import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-optimizer' });

type SqlClient = ReturnType<typeof postgres>;

export type OptimizationSeverity = 'info' | 'warning' | 'critical';

export interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  severity: OptimizationSeverity;
  /** Estimated token savings per query if applied. */
  estimatedSavingsPercent: number;
}

export interface HotEntity {
  entityId: string;
  entityType: string;
  label: string;
  queryHits: number;
}

export interface IndexOptimizationReport {
  workspaceId: string;
  analyzedAt: string;
  totalEntities: number;
  hotEntities: HotEntity[];
  suggestions: OptimizationSuggestion[];
  cacheHitRatePct: number;
  compressionRatioPct: number;
}

type AuditRow = {
  tool_name: string;
  query: string;
  token_estimate: number;
  cache_hit: boolean;
  tokens_saved_caching: number;
  tokens_saved_compression: number;
  timestamp: Date;
};

type IndexRow = {
  entity_type: string;
  entity_count: string;
  total_bytes: string;
};

/**
 * Analyses query audit logs and index status tables to produce concrete
 * optimization recommendations for a workspace's semantic index.
 */
export class IndexOptimizer {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Analyze a workspace's query patterns and index health, returning a report
   * with hot entities and actionable optimization suggestions.
   *
   * @param workspaceId - Workspace to analyze
   * @param lookbackDays - How many days of audit logs to scan. Default: 7
   * @returns Result with the optimization report
   */
  async analyze(
    workspaceId: string,
    lookbackDays = 7,
  ): Promise<Result<IndexOptimizationReport, Error>> {
    try {
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

      // Pull recent audit events for this workspace
      const auditRows = await this.sql<AuditRow[]>`
        SELECT tool_name, query, token_estimate, cache_hit,
               tokens_saved_caching, tokens_saved_compression, timestamp
        FROM audit_log
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= ${since}
        ORDER BY timestamp DESC
        LIMIT 10000
      `;

      // Pull index coverage
      const indexRows = await this.sql<IndexRow[]>`
        SELECT entity_type, entity_count, total_bytes
        FROM index_status
        WHERE workspace_id = ${workspaceId}
      `;

      const totalEntities = indexRows.reduce((sum, r) => sum + parseInt(r.entity_count, 10), 0);
      const totalQueries = auditRows.length;
      const cacheHits = auditRows.filter(r => r.cache_hit).length;
      const cacheHitRatePct = totalQueries > 0 ? Math.round((cacheHits / totalQueries) * 100) : 0;

      const totalTokensSpent = auditRows.reduce((s, r) => s + r.token_estimate, 0);
      const totalSaved = auditRows.reduce(
        (s, r) => s + r.tokens_saved_caching + r.tokens_saved_compression, 0,
      );
      const compressionRatioPct = totalTokensSpent > 0
        ? Math.round((totalSaved / (totalTokensSpent + totalSaved)) * 100)
        : 0;

      // Hot entities: queries that mentioned specific entity types most often
      const typeCounts = new Map<string, number>();
      for (const row of indexRows) {
        typeCounts.set(row.entity_type, parseInt(row.entity_count, 10));
      }

      // Build hot entity list from index (use entity_type as proxy for top entities)
      const hotEntities: HotEntity[] = indexRows
        .sort((a, b) => parseInt(b.entity_count, 10) - parseInt(a.entity_count, 10))
        .slice(0, 10)
        .map(r => ({
          entityId: `${workspaceId}:${r.entity_type}`,
          entityType: r.entity_type,
          label: r.entity_type,
          queryHits: parseInt(r.entity_count, 10),
        }));

      const suggestions = this.buildSuggestions({
        cacheHitRatePct,
        compressionRatioPct,
        totalEntities,
        totalQueries,
        indexRows,
      });

      const report: IndexOptimizationReport = {
        workspaceId,
        analyzedAt: new Date().toISOString(),
        totalEntities,
        hotEntities,
        suggestions,
        cacheHitRatePct,
        compressionRatioPct,
      };

      log.info('Index optimization analysis complete', {
        workspaceId,
        totalEntities,
        totalQueries,
        cacheHitRatePct,
        suggestionCount: suggestions.length,
      });

      return ok(report);
    } catch (e) {
      log.error('Index optimization analysis failed', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private buildSuggestions(params: {
    cacheHitRatePct: number;
    compressionRatioPct: number;
    totalEntities: number;
    totalQueries: number;
    indexRows: IndexRow[];
  }): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const { cacheHitRatePct, compressionRatioPct, totalEntities, totalQueries, indexRows } = params;

    if (cacheHitRatePct < 30 && totalQueries > 100) {
      suggestions.push({
        id: 'low-cache-hit-rate',
        title: 'Low semantic cache hit rate',
        description: `Cache hit rate is ${cacheHitRatePct}%. Consider lowering the similarity threshold from 0.92 to 0.88 for less strict matching, or increase the cache TTL to retain results longer.`,
        severity: cacheHitRatePct < 10 ? 'critical' : 'warning',
        estimatedSavingsPercent: Math.round((30 - cacheHitRatePct) * 1.5),
      });
    }

    if (compressionRatioPct < 20 && totalQueries > 50) {
      suggestions.push({
        id: 'low-compression-ratio',
        title: 'Low compression savings',
        description: 'Context compression is saving less than 20% of tokens. Review entity attribute verbosity — consider excluding low-signal fields from embedding inputs.',
        severity: 'info',
        estimatedSavingsPercent: 15,
      });
    }

    if (totalEntities > 500_000) {
      suggestions.push({
        id: 'large-index',
        title: 'Large index — consider partial indexing',
        description: `${totalEntities.toLocaleString()} entities indexed. For types with > 100K entries, index only the top-k most recently modified to reduce ANN search latency and embedding cost.`,
        severity: 'warning',
        estimatedSavingsPercent: 25,
      });
    }

    const largeTypes = indexRows.filter(r => parseInt(r.entity_count, 10) > 100_000);
    for (const t of largeTypes) {
      suggestions.push({
        id: `partial-index-${t.entity_type}`,
        title: `Partial index recommended for "${t.entity_type}"`,
        description: `${parseInt(t.entity_count, 10).toLocaleString()} ${t.entity_type} entities indexed. Add a lastModified filter in the connector's sync() to limit to recent data.`,
        severity: 'info',
        estimatedSavingsPercent: 10,
      });
    }

    if (totalQueries === 0) {
      suggestions.push({
        id: 'no-recent-queries',
        title: 'No recent query activity',
        description: 'No queries in the last 7 days. Ensure MCP server is connected and API keys are configured.',
        severity: 'info',
        estimatedSavingsPercent: 0,
      });
    }

    return suggestions;
  }
}
