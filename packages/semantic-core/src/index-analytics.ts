import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'index-analytics' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityTypeCount {
  entityType: string;
  count: number;
  storageBytesEstimate: number;
}

export interface ConnectorContribution {
  connectorId: string;
  entityCount: number;
  pctOfTotal: number;
}

export interface CompositionMetrics {
  workspaceId: string;
  totalEntities: number;
  byEntityType: EntityTypeCount[];
  byConnector: ConnectorContribution[];
  snapshotAt: string;
}

export interface FreshnessMetrics {
  workspaceId: string;
  pctUpdatedLast7Days: number;
  pctUpdatedLast30Days: number;
  avgAgeByType: Record<string, number>;
  lastSyncByConnector: Record<string, string | null>;
}

export interface QualityMetrics {
  workspaceId: string;
  pctWithRelationships: number;
  avgRelationshipDensity: number;
  embeddingCoveragePct: number;
  dedupRatioLast30Days: number;
}

export interface OptimizationOpportunity {
  id: string;
  type: 'dedup' | 'archive_connector' | 'prune_stale' | 'index_rebalance';
  title: string;
  description: string;
  estimatedMonthlySavingsCents: number;
  priority: 'high' | 'medium' | 'low';
}

export interface IndexAnalyticsReport {
  composition: CompositionMetrics;
  freshness: FreshnessMetrics;
  quality: QualityMetrics;
  opportunities: OptimizationOpportunity[];
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface TypeCountRow {
  entity_type: string;
  count: string;
}

interface ConnectorCountRow {
  source_connector_id: string | null;
  count: string;
}

interface RelationshipStatsRow {
  pct_with_relationships: string;
  avg_relationship_density: string;
}

interface EmbeddingCoverageRow {
  pct_embedded: string;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Provides index composition, freshness, quality, and optimization analytics
 * for a workspace's semantic index.
 */
export class IndexAnalyticsService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Returns entity type and connector contribution breakdown.
   * @param workspaceId - Target workspace
   */
  async getCompositionMetrics(workspaceId: string): Promise<Result<CompositionMetrics, Error>> {
    try {
      const typeRows = await this.sql`
        SELECT entity_type, COUNT(*)::TEXT AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
        GROUP BY entity_type
        ORDER BY count DESC
      ` as TypeCountRow[];

      const connectorRows = await this.sql`
        SELECT source_connector_id, COUNT(*)::TEXT AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
        GROUP BY source_connector_id
        ORDER BY count DESC
      ` as ConnectorCountRow[];

      const totalEntities = typeRows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

      const byEntityType: EntityTypeCount[] = typeRows.map((r) => ({
        entityType: r.entity_type,
        count: parseInt(r.count, 10),
        storageBytesEstimate: parseInt(r.count, 10) * 6144,
      }));

      const byConnector: ConnectorContribution[] = connectorRows.map((r) => {
        const count = parseInt(r.count, 10);
        return {
          connectorId: r.source_connector_id ?? 'unknown',
          entityCount: count,
          pctOfTotal: totalEntities > 0 ? parseFloat(((count / totalEntities) * 100).toFixed(1)) : 0,
        };
      });

      log.info('Composition metrics computed', { workspaceId, totalEntities });

      return ok({
        workspaceId,
        totalEntities,
        byEntityType,
        byConnector,
        snapshotAt: new Date().toISOString(),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns data freshness metrics: % updated recently, avg age by type.
   * @param workspaceId - Target workspace
   */
  async getFreshnessMetrics(workspaceId: string): Promise<Result<FreshnessMetrics, Error>> {
    try {
      const totalRow = await this.sql`
        SELECT COUNT(*)::TEXT AS count FROM indexed_entities WHERE workspace_id = ${workspaceId}
      ` as Array<{ count: string }>;

      const total = parseInt(totalRow[0]?.count ?? '0', 10);

      const updated7Row = await this.sql`
        SELECT COUNT(*)::TEXT AS count FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified >= NOW() - INTERVAL '7 days'
      ` as Array<{ count: string }>;

      const updated30Row = await this.sql`
        SELECT COUNT(*)::TEXT AS count FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified >= NOW() - INTERVAL '30 days'
      ` as Array<{ count: string }>;

      const avgAgeRows = await this.sql`
        SELECT entity_type,
               EXTRACT(EPOCH FROM (NOW() - AVG(last_modified::TIMESTAMPTZ))) / 86400 AS avg_age_days
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified IS NOT NULL
        GROUP BY entity_type
      ` as Array<{ entity_type: string; avg_age_days: string }>;

      const lastSyncRows = await this.sql`
        SELECT DISTINCT ON (source_connector_id)
               source_connector_id,
               MAX(last_modified)::TEXT AS last_sync
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
        GROUP BY source_connector_id
      ` as Array<{ source_connector_id: string | null; last_sync: string | null }>;

      const updated7 = parseInt(updated7Row[0]?.count ?? '0', 10);
      const updated30 = parseInt(updated30Row[0]?.count ?? '0', 10);

      const avgAgeByType: Record<string, number> = {};
      for (const r of avgAgeRows) {
        avgAgeByType[r.entity_type] = parseFloat(parseFloat(r.avg_age_days).toFixed(1));
      }

      const lastSyncByConnector: Record<string, string | null> = {};
      for (const r of lastSyncRows) {
        if (r.source_connector_id) lastSyncByConnector[r.source_connector_id] = r.last_sync;
      }

      return ok({
        workspaceId,
        pctUpdatedLast7Days: total > 0 ? parseFloat(((updated7 / total) * 100).toFixed(1)) : 0,
        pctUpdatedLast30Days: total > 0 ? parseFloat(((updated30 / total) * 100).toFixed(1)) : 0,
        avgAgeByType,
        lastSyncByConnector,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns entity quality metrics: relationship coverage, embedding coverage, dedup ratio.
   * @param workspaceId - Target workspace
   */
  async getQualityMetrics(workspaceId: string): Promise<Result<QualityMetrics, Error>> {
    try {
      const totalRow = await this.sql`
        SELECT COUNT(*)::TEXT AS count FROM indexed_entities WHERE workspace_id = ${workspaceId}
      ` as Array<{ count: string }>;

      const relRows = await this.sql`
        SELECT
          COUNT(DISTINCT er.entity_id)::TEXT AS with_relationships,
          CASE WHEN COUNT(DISTINCT er.entity_id) > 0
               THEN (COUNT(er.entity_id)::FLOAT / COUNT(DISTINCT er.entity_id))
               ELSE 0 END AS avg_density
        FROM indexed_entities ie
        LEFT JOIN entity_relationships er ON er.entity_id = ie.id
        WHERE ie.workspace_id = ${workspaceId}
      ` as Array<{ with_relationships: string; avg_density: string }>;

      const embRow = await this.sql`
        SELECT ROUND(AVG(CASE WHEN embedding IS NOT NULL THEN 1.0 ELSE 0 END) * 100, 1)::TEXT AS pct_embedded
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
      ` as Array<{ pct_embedded: string }>;

      const dedupRow = await this.sql`
        SELECT COALESCE(SUM(records_affected), 0)::TEXT AS total_merged
        FROM index_maintenance_jobs
        WHERE workspace_id = ${workspaceId}
          AND job_type = 'deduplicate'
          AND status = 'completed'
          AND started_at > NOW() - INTERVAL '30 days'
      ` as Array<{ total_merged: string }>;

      const total = parseInt(totalRow[0]?.count ?? '0', 10);
      const withRel = parseInt(relRows[0]?.with_relationships ?? '0', 10);
      const avgDensity = parseFloat(relRows[0]?.avg_density ?? '0');
      const pctEmbedded = parseFloat(embRow[0]?.pct_embedded ?? '0');
      const dedupMerged = parseInt(dedupRow[0]?.total_merged ?? '0', 10);

      return ok({
        workspaceId,
        pctWithRelationships: total > 0 ? parseFloat(((withRel / total) * 100).toFixed(1)) : 0,
        avgRelationshipDensity: parseFloat(avgDensity.toFixed(2)),
        embeddingCoveragePct: pctEmbedded,
        dedupRatioLast30Days: total > 0 ? parseFloat(((dedupMerged / total) * 100).toFixed(2)) : 0,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns ranked optimization recommendations for the workspace.
   * @param workspaceId - Target workspace
   */
  async getOptimizationOpportunities(workspaceId: string): Promise<Result<OptimizationOpportunity[], Error>> {
    try {
      const opportunities: OptimizationOpportunity[] = [];

      // Check for duplicate-heavy entity types
      const dupeRows = await this.sql`
        SELECT entity_type, COUNT(*)::TEXT AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
        GROUP BY entity_type
        HAVING COUNT(*) > 1000
        ORDER BY count DESC
        LIMIT 5
      ` as Array<{ entity_type: string; count: string }>;

      for (const r of dupeRows) {
        const count = parseInt(r.count, 10);
        const dupEstimate = Math.round(count * 0.03);
        if (dupEstimate > 50) {
          opportunities.push({
            id: `dedup-${r.entity_type}`,
            type: 'dedup',
            title: `Deduplicate ${r.entity_type} entities`,
            description: `~${dupEstimate} duplicate ${r.entity_type} entities estimated (3% baseline). Run dedup to save ~${Math.round(dupEstimate * 6144 / 1024)}KB storage.`,
            estimatedMonthlySavingsCents: Math.round(dupEstimate * 0.2),
            priority: dupEstimate > 100 ? 'high' : 'medium',
          });
        }
      }

      // Check for stale connectors (no sync in 60 days)
      const staleConnRows = await this.sql`
        SELECT source_connector_id, MAX(last_modified)::TEXT AS last_sync, COUNT(*)::TEXT AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND source_connector_id IS NOT NULL
        GROUP BY source_connector_id
        HAVING MAX(last_modified) < NOW() - INTERVAL '60 days' OR MAX(last_modified) IS NULL
      ` as Array<{ source_connector_id: string; last_sync: string | null; count: string }>;

      for (const r of staleConnRows) {
        opportunities.push({
          id: `archive-${r.source_connector_id}`,
          type: 'archive_connector',
          title: `Archive stale connector: ${r.source_connector_id}`,
          description: `Connector has ${r.count} entities but no sync in 60+ days. Archiving frees ~${Math.round(parseInt(r.count, 10) * 6144 / 1024)}KB storage.`,
          estimatedMonthlySavingsCents: Math.round(parseInt(r.count, 10) * 0.1),
          priority: 'low',
        });
      }

      // Check for missing embeddings
      const missingEmbRow = await this.sql`
        SELECT COUNT(*)::TEXT AS count
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND embedding IS NULL
      ` as Array<{ count: string }>;

      const missingEmb = parseInt(missingEmbRow[0]?.count ?? '0', 10);
      if (missingEmb > 100) {
        opportunities.push({
          id: 'missing-embeddings',
          type: 'index_rebalance',
          title: 'Re-index entities missing embeddings',
          description: `${missingEmb} entities have no embedding vector — they will not appear in semantic search results.`,
          estimatedMonthlySavingsCents: 0,
          priority: missingEmb > 500 ? 'high' : 'medium',
        });
      }

      opportunities.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
      });

      log.info('Optimization opportunities computed', { workspaceId, count: opportunities.length });
      return ok(opportunities);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Saves a composition snapshot for trend tracking.
   * @param workspaceId - Target workspace
   * @param composition - Current composition metrics
   */
  async saveSnapshot(workspaceId: string, composition: CompositionMetrics): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO index_composition_snapshots
          (workspace_id, snapshot_date, entity_types_json, connector_contributions_json, freshness_metrics_json)
        VALUES (
          ${workspaceId},
          NOW()::DATE,
          ${JSON.stringify(composition.byEntityType)},
          ${JSON.stringify(composition.byConnector)},
          ${JSON.stringify({})}
        )
        ON CONFLICT (workspace_id, snapshot_date) DO UPDATE
          SET entity_types_json = EXCLUDED.entity_types_json,
              connector_contributions_json = EXCLUDED.connector_contributions_json
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieves historical composition snapshots for trend analysis.
   * @param workspaceId - Target workspace
   * @param days - Number of days of history to return
   */
  async getSnapshots(workspaceId: string, days = 30): Promise<Result<Array<{ date: string; totalEntities: number }>, Error>> {
    try {
      const rows = await this.sql`
        SELECT snapshot_date::TEXT AS date,
               (
                 SELECT SUM((v->>'count')::INT)
                 FROM jsonb_array_elements(entity_types_json) AS v
               )::TEXT AS total
        FROM index_composition_snapshots
        WHERE workspace_id = ${workspaceId}
          AND snapshot_date >= NOW()::DATE - ${days}
        ORDER BY snapshot_date ASC
      `.catch((): unknown[] => []) as Array<{ date: string; total: string }>;

      return ok(rows.map((r) => ({ date: r.date, totalEntities: parseInt(r.total ?? '0', 10) })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
