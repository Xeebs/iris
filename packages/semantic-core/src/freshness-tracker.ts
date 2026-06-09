import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'freshness-tracker' });

// ─── Types ────────────────────────────────────────────────────────────────────

type FreshnessRecord = {
  entityId: string;
  entityType: string;
  connectorId: string;
  workspaceId: string;
  lastModified: Date;
  indexedAt: Date;
  syncLatencyMs: number;
};

type FreshnessStatus = {
  entityId: string;
  entityType: string;
  ageSeconds: number;
  indexedAt: Date;
  lastModified: Date;
  stalenessWarning: boolean;
  slaBreached: boolean;
  slaSec: number | null;
  freshnessPercentile: number | null;
};

type FreshnessMetrics = {
  connectorId: string;
  intervalDays: number;
  meanTimeToIndexMs: number;
  syncFrequencyHz: number;
  freshnessP50: number;
  freshnessP95: number;
  freshnessP99: number;
  slaComplianceRate: number;
  entityTypeBreakdown: { entityType: string; meanAgeSec: number; count: number }[];
};

type StaleEventPrediction = {
  entityId: string;
  connectorId: string;
  estimatedStalenessAt: Date | null;
  confidenceScore: number;
  avgModificationIntervalSec: number;
};

type FreshnessError = { code: string; message: string };

type SqlClient = ReturnType<typeof postgres>;

// ─── FreshnessTracker ─────────────────────────────────────────────────────────

/**
 * Tracks entity data freshness, computes SLA compliance, and predicts staleness.
 */
export class FreshnessTracker {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Records an entity sync event, capturing modification timestamp and index latency.
   * @param entityId - Canonical entity ID
   * @param entityType - Entity type (contact, deal, etc.)
   * @param connectorId - Source connector ID
   * @param workspaceId - Workspace scope
   * @param lastModified - When the entity was last modified in the source system
   * @returns Result with upserted record or error
   */
  async recordEntitySync(
    entityId: string,
    entityType: string,
    connectorId: string,
    workspaceId: string,
    lastModified: Date,
  ): Promise<Result<FreshnessRecord, FreshnessError>> {
    const now = new Date();
    const syncLatencyMs = now.getTime() - lastModified.getTime();

    try {
      await this.sql`
        INSERT INTO entity_freshness_tracking
          (entity_id, entity_type, connector_id, workspace_id, last_modified, indexed_at, sync_latency_ms, updated_at)
        VALUES
          (${entityId}, ${entityType}, ${connectorId}, ${workspaceId}, ${lastModified}, ${now}, ${syncLatencyMs}, ${now})
        ON CONFLICT (entity_id) DO UPDATE SET
          entity_type     = EXCLUDED.entity_type,
          last_modified   = EXCLUDED.last_modified,
          indexed_at      = EXCLUDED.indexed_at,
          sync_latency_ms = EXCLUDED.sync_latency_ms,
          updated_at      = EXCLUDED.updated_at
      `;

      await this.sql`
        INSERT INTO freshness_events
          (entity_id, entity_type, connector_id, workspace_id, event_type, age_seconds)
        VALUES
          (${entityId}, ${entityType}, ${connectorId}, ${workspaceId}, 'sync',
           ${Math.floor(syncLatencyMs / 1000)})
      `;

      log.debug('Recorded entity sync', { entityId, entityType, connectorId, syncLatencyMs });

      return ok({
        entityId,
        entityType,
        connectorId,
        workspaceId,
        lastModified,
        indexedAt: now,
        syncLatencyMs,
      });
    } catch (e) {
      log.error('Failed to record entity sync', { entityId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Computes freshness status for a single entity, including SLA compliance.
   * @param entityId - Entity to evaluate
   * @param workspaceId - Workspace scope
   * @returns Freshness status or error
   */
  async computeFreshness(
    entityId: string,
    workspaceId: string,
  ): Promise<Result<FreshnessStatus, FreshnessError>> {
    try {
      const rows = await this.sql<
        {
          entity_id: string;
          entity_type: string;
          connector_id: string;
          last_modified: Date;
          indexed_at: Date;
        }[]
      >`
        SELECT entity_id, entity_type, connector_id, last_modified, indexed_at
        FROM entity_freshness_tracking
        WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return err({ code: 'NOT_FOUND', message: `No freshness record for entity ${entityId}` });
      }

      const row = rows[0]!;
      const now = new Date();
      const ageSeconds = Math.floor((now.getTime() - row.last_modified.getTime()) / 1000);

      // Fetch applicable SLA
      const slaRows = await this.sql<{ max_age_seconds: number; warning_threshold_pct: number }[]>`
        SELECT max_age_seconds, warning_threshold_pct
        FROM freshness_slas
        WHERE workspace_id = ${workspaceId}
          AND (connector_id = ${row.connector_id} OR connector_id IS NULL)
          AND (entity_type = ${row.entity_type} OR entity_type IS NULL)
        ORDER BY connector_id NULLS LAST, entity_type NULLS LAST
        LIMIT 1
      `;

      const sla = slaRows[0] ?? null;
      const slaSec = sla?.max_age_seconds ?? null;
      const warnThreshold = sla?.warning_threshold_pct ?? 80;
      const slaBreached = slaSec !== null && ageSeconds > slaSec;
      const stalenessWarning =
        slaSec !== null && !slaBreached && ageSeconds > (slaSec * warnThreshold) / 100;

      // Compute percentile rank across entity type
      const pctRows = await this.sql<{ percentile: number }[]>`
        SELECT PERCENT_RANK() OVER (ORDER BY age_sec) AS percentile
        FROM (
          SELECT EXTRACT(EPOCH FROM (NOW() - last_modified))::BIGINT AS age_sec
          FROM entity_freshness_tracking
          WHERE workspace_id = ${workspaceId} AND entity_type = ${row.entity_type}
        ) sub
        WHERE age_sec <= ${ageSeconds}
        LIMIT 1
      `;

      const freshnessPercentile =
        pctRows.length > 0 ? Math.round((pctRows[0]!.percentile ?? 0) * 100) : null;

      if (slaBreached) {
        await this.recordFreshnessEvent(entityId, row.entity_type, row.connector_id, workspaceId, 'sla_breach', ageSeconds, slaSec);
      } else if (stalenessWarning) {
        await this.recordFreshnessEvent(entityId, row.entity_type, row.connector_id, workspaceId, 'stale_warning', ageSeconds, slaSec);
      }

      return ok({
        entityId,
        entityType: row.entity_type,
        ageSeconds,
        indexedAt: row.indexed_at,
        lastModified: row.last_modified,
        stalenessWarning,
        slaBreached,
        slaSec,
        freshnessPercentile,
      });
    } catch (e) {
      log.error('Failed to compute freshness', { entityId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Analyzes freshness metrics for a connector over a time interval.
   * @param connectorId - Target connector
   * @param workspaceId - Workspace scope
   * @param intervalDays - Analysis window in days
   * @returns Aggregated freshness metrics
   */
  async analyzeFreshnessMetrics(
    connectorId: string,
    workspaceId: string,
    intervalDays = 7,
  ): Promise<Result<FreshnessMetrics, FreshnessError>> {
    try {
      const since = new Date(Date.now() - intervalDays * 86400 * 1000);

      const latencyRow = await this.sql<{ mean_latency: number; event_count: number }[]>`
        SELECT
          AVG(age_seconds * 1000.0)::NUMERIC AS mean_latency,
          COUNT(*)::INTEGER AS event_count
        FROM freshness_events
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND event_type = 'sync'
          AND created_at >= ${since}
      `;

      const percRows = await this.sql<{
        p50: number;
        p95: number;
        p99: number;
      }[]>`
        SELECT
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - last_modified))) AS p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - last_modified))) AS p95,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - last_modified))) AS p99
        FROM entity_freshness_tracking
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
      `;

      const slaRows = await this.sql<{ total: number; within_sla: number }[]>`
        SELECT
          COUNT(*)::INTEGER AS total,
          COUNT(*) FILTER (WHERE fe.age_seconds <= fs.max_age_seconds)::INTEGER AS within_sla
        FROM freshness_events fe
        LEFT JOIN freshness_slas fs
          ON fs.workspace_id = ${workspaceId}
          AND (fs.connector_id = ${connectorId} OR fs.connector_id IS NULL)
          AND (fs.entity_type = fe.entity_type OR fs.entity_type IS NULL)
        WHERE fe.connector_id = ${connectorId}
          AND fe.workspace_id = ${workspaceId}
          AND fe.created_at >= ${since}
          AND fs.max_age_seconds IS NOT NULL
      `;

      const typeRows = await this.sql<{
        entity_type: string;
        mean_age_sec: number;
        entity_count: number;
      }[]>`
        SELECT
          entity_type,
          AVG(EXTRACT(EPOCH FROM (NOW() - last_modified)))::NUMERIC AS mean_age_sec,
          COUNT(*)::INTEGER AS entity_count
        FROM entity_freshness_tracking
        WHERE connector_id = ${connectorId} AND workspace_id = ${workspaceId}
        GROUP BY entity_type
      `;

      const latency = latencyRow[0] ?? { mean_latency: 0, event_count: 0 };
      const percs = percRows[0] ?? { p50: 0, p95: 0, p99: 0 };
      const slaComp = slaRows[0] ?? { total: 0, within_sla: 0 };
      const slaRate = slaComp.total > 0 ? slaComp.within_sla / slaComp.total : 1;
      const intervalSec = intervalDays * 86400;
      const syncHz = latency.event_count > 0 ? latency.event_count / intervalSec : 0;

      return ok({
        connectorId,
        intervalDays,
        meanTimeToIndexMs: Math.round(Number(latency.mean_latency) ?? 0),
        syncFrequencyHz: Math.round(syncHz * 1000) / 1000,
        freshnessP50: Math.round(Number(percs.p50) ?? 0),
        freshnessP95: Math.round(Number(percs.p95) ?? 0),
        freshnessP99: Math.round(Number(percs.p99) ?? 0),
        slaComplianceRate: Math.round(slaRate * 10000) / 100,
        entityTypeBreakdown: typeRows.map((r) => ({
          entityType: r.entity_type,
          meanAgeSec: Math.round(Number(r.mean_age_sec) ?? 0),
          count: r.entity_count,
        })),
      });
    } catch (e) {
      log.error('Failed to analyze freshness metrics', { connectorId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Predicts when an entity will next exceed its freshness SLA based on modification patterns.
   * @param entityId - Entity to forecast
   * @param connectorId - Source connector
   * @param workspaceId - Workspace scope
   * @returns Staleness prediction with estimated timestamp and confidence
   */
  async predictNextStaleEvent(
    entityId: string,
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<StaleEventPrediction, FreshnessError>> {
    try {
      const historyRows = await this.sql<{ created_at: Date }[]>`
        SELECT created_at
        FROM freshness_events
        WHERE entity_id = ${entityId}
          AND connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND event_type = 'sync'
        ORDER BY created_at DESC
        LIMIT 20
      `;

      const slaRow = await this.sql<{
        entity_type: string;
        max_age_seconds: number | null;
      }[]>`
        SELECT eft.entity_type, fs.max_age_seconds
        FROM entity_freshness_tracking eft
        LEFT JOIN freshness_slas fs
          ON fs.workspace_id = ${workspaceId}
          AND (fs.connector_id = ${connectorId} OR fs.connector_id IS NULL)
          AND (fs.entity_type = eft.entity_type OR fs.entity_type IS NULL)
        WHERE eft.entity_id = ${entityId} AND eft.workspace_id = ${workspaceId}
        ORDER BY fs.connector_id NULLS LAST, fs.entity_type NULLS LAST
        LIMIT 1
      `;

      const slaSec = slaRow[0]?.max_age_seconds ?? null;

      if (historyRows.length < 2) {
        return ok({
          entityId,
          connectorId,
          estimatedStalenessAt: null,
          confidenceScore: 0,
          avgModificationIntervalSec: 0,
        });
      }

      const intervals: number[] = [];
      for (let i = 0; i < historyRows.length - 1; i++) {
        const delta =
          historyRows[i]!.created_at.getTime() - historyRows[i + 1]!.created_at.getTime();
        intervals.push(delta / 1000);
      }

      const avgIntervalSec =
        intervals.reduce((sum, v) => sum + v, 0) / intervals.length;

      const variance =
        intervals.reduce((sum, v) => sum + Math.pow(v - avgIntervalSec, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const cv = avgIntervalSec > 0 ? stdDev / avgIntervalSec : 1;
      const confidence = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));

      const lastSync = historyRows[0]!.created_at;
      const estimatedNextModSec = lastSync.getTime() / 1000 + avgIntervalSec;

      let estimatedStalenessAt: Date | null = null;
      if (slaSec !== null) {
        const staleAt = new Date((estimatedNextModSec + slaSec) * 1000);
        estimatedStalenessAt = staleAt;
      }

      return ok({
        entityId,
        connectorId,
        estimatedStalenessAt,
        confidenceScore: confidence,
        avgModificationIntervalSec: Math.round(avgIntervalSec),
      });
    } catch (e) {
      log.error('Failed to predict stale event', { entityId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  /**
   * Lists entities approaching or breaching their freshness SLA.
   * @param workspaceId - Workspace scope
   * @param connectorId - Optional connector filter
   * @param limit - Max results
   * @returns Array of freshness status records
   */
  async listStaleEntities(
    workspaceId: string,
    connectorId?: string,
    limit = 50,
  ): Promise<Result<FreshnessStatus[], FreshnessError>> {
    try {
      const rows = await this.sql<{
        entity_id: string;
        entity_type: string;
        connector_id: string;
        last_modified: Date;
        indexed_at: Date;
        age_seconds: number;
        sla_seconds: number | null;
      }[]>`
        SELECT
          eft.entity_id,
          eft.entity_type,
          eft.connector_id,
          eft.last_modified,
          eft.indexed_at,
          EXTRACT(EPOCH FROM (NOW() - eft.last_modified))::BIGINT AS age_seconds,
          fs.max_age_seconds AS sla_seconds
        FROM entity_freshness_tracking eft
        LEFT JOIN freshness_slas fs
          ON fs.workspace_id = ${workspaceId}
          AND (fs.connector_id = eft.connector_id OR fs.connector_id IS NULL)
          AND (fs.entity_type = eft.entity_type OR fs.entity_type IS NULL)
        WHERE eft.workspace_id = ${workspaceId}
          AND (${connectorId ?? null}::TEXT IS NULL OR eft.connector_id = ${connectorId ?? null})
          AND (
            fs.max_age_seconds IS NULL
            OR EXTRACT(EPOCH FROM (NOW() - eft.last_modified)) > fs.max_age_seconds * 0.8
          )
        ORDER BY age_seconds DESC
        LIMIT ${limit}
      `;

      const statuses = rows.map((r) => {
        const slaSec = r.sla_seconds;
        const slaBreached = slaSec !== null && r.age_seconds > slaSec;
        const stalenessWarning = slaSec !== null && !slaBreached && r.age_seconds > slaSec * 0.8;
        return {
          entityId: r.entity_id,
          entityType: r.entity_type,
          ageSeconds: r.age_seconds,
          indexedAt: r.indexed_at,
          lastModified: r.last_modified,
          stalenessWarning,
          slaBreached,
          slaSec,
          freshnessPercentile: null,
        } satisfies FreshnessStatus;
      });

      return ok(statuses);
    } catch (e) {
      log.error('Failed to list stale entities', { workspaceId, error: e });
      return err({ code: 'DB_ERROR', message: String(e) });
    }
  }

  private async recordFreshnessEvent(
    entityId: string,
    entityType: string,
    connectorId: string,
    workspaceId: string,
    eventType: 'stale_warning' | 'sla_breach',
    ageSec: number,
    slaSec: number | null,
  ): Promise<void> {
    try {
      await this.sql`
        INSERT INTO freshness_events
          (entity_id, entity_type, connector_id, workspace_id, event_type, age_seconds, sla_seconds)
        VALUES
          (${entityId}, ${entityType}, ${connectorId}, ${workspaceId}, ${eventType}, ${ageSec}, ${slaSec})
      `;
    } catch (e) {
      log.warn('Failed to record freshness event', { entityId, eventType, error: e });
    }
  }
}
