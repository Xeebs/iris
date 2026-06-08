import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';

const log = logger.child({ service: 'sync-quality-monitor' });

type SqlClient = ReturnType<typeof postgres>;

export interface SyncQualityInput {
  entityCount: number;
  /** Pre-computed completeness 0–100 (% non-null attributes), or auto-computed when entities provided. */
  completenessePct?: number;
  /** Pre-computed unique value ratio 0–1, or auto-computed when entities provided. */
  uniqueValueRatio?: number;
  /** Pre-computed schema stability 0–100, or auto-computed when knownAttributeNames provided. */
  schemaStabilityPct?: number;
  /** Raw entities for auto-computation of completeness + uniqueness. */
  entities?: SemanticEntity[];
  /** Previous attribute names for schema drift detection. */
  knownAttributeNames?: string[];
  /** Observed attribute names this sync. */
  attributeNames?: string[];
}

export interface SyncQualityRecord {
  id: string;
  syncId: string;
  connectorId: string;
  workspaceId: string;
  entityCount: number;
  completenessePct: number;
  uniqueValueRatio: number;
  schemaStabilityPct: number;
  anomalyFlags: string[];
  attributeNames: string[];
  recordedAt: Date;
}

export type AnomalyType = 'entity_count_deviation' | 'completeness_drop' | 'schema_drift';

export interface Anomaly {
  type: AnomalyType;
  severity: 'warning' | 'critical';
  description: string;
  zScore?: number;
  currentValue?: number;
  baselineValue?: number;
  newAttributes?: string[];
}

export interface AnomalyReport {
  connectorId: string;
  workspaceId: string;
  anomalies: Anomaly[];
  detectedAt: Date;
}

export interface QualityThresholds {
  entityCountZscoreThreshold: number;
  completenessDropThreshold: number;
}

export interface TrendPoint {
  syncId: string;
  recordedAt: Date;
  entityCount: number;
  completenessePct: number;
  schemaStabilityPct: number;
  anomalyFlags: string[];
}

export interface DataQualityTrend {
  connectorId: string;
  workspaceId: string;
  windowDays: number;
  dataPoints: TrendPoint[];
  summary: {
    entityCountTrend: 'growing' | 'stable' | 'declining';
    completenessTrend: 'improving' | 'stable' | 'degrading';
    hasRecentAnomaly: boolean;
  };
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  entityCountZscoreThreshold: 3.0,
  completenessDropThreshold: 0.20,
};

const BASELINE_WINDOW_DAYS = 30;

// ─── Pure computation helpers ─────────────────────────────────────────────────

/**
 * Compute attribute completeness: ratio of non-null attribute values across all entities.
 *
 * @param entities - Entities to analyze
 * @returns Completeness percentage 0–100
 */
export function computeCompleteness(entities: SemanticEntity[]): number {
  if (entities.length === 0) return 100;

  let total = 0;
  let nonNull = 0;

  for (const entity of entities) {
    for (const value of Object.values(entity.attributes)) {
      total++;
      if (value !== null && value !== undefined && value !== '') nonNull++;
    }
  }

  if (total === 0) return 100;
  return Math.round((nonNull / total) * 10000) / 100;
}

/**
 * Compute unique value ratio: for each attribute, count distinct values / total values,
 * then average across attributes. Higher = more diverse data.
 *
 * @param entities - Entities to analyze
 * @returns Unique value ratio 0–1
 */
export function computeUniqueValueRatio(entities: SemanticEntity[]): number {
  if (entities.length === 0) return 1;

  const attrValues: Map<string, Set<string>> = new Map();
  const attrCounts: Map<string, number> = new Map();

  for (const entity of entities) {
    for (const [key, value] of Object.entries(entity.attributes)) {
      if (value === null || value === undefined) continue;
      const normalized = normalizeAttributeValue(value);
      if (!attrValues.has(key)) {
        attrValues.set(key, new Set());
        attrCounts.set(key, 0);
      }
      attrValues.get(key)!.add(normalized);
      attrCounts.set(key, (attrCounts.get(key) ?? 0) + 1);
    }
  }

  if (attrValues.size === 0) return 1;

  let totalRatio = 0;
  for (const [key, uniqueSet] of attrValues) {
    const count = attrCounts.get(key) ?? 1;
    totalRatio += uniqueSet.size / count;
  }

  return Math.round((totalRatio / attrValues.size) * 10000) / 10000;
}

function normalizeAttributeValue(value: AttributeValue): string {
  if (Array.isArray(value)) return value.join(',');
  return String(value).toLowerCase().trim();
}

/**
 * Compute schema stability: ratio of current attribute names that match the known set.
 * Returns 100 when no known schema exists (first sync).
 *
 * @param currentNames - Attribute names observed in this sync
 * @param knownNames - Previously known attribute names (baseline schema)
 * @returns Stability percentage 0–100
 */
export function computeSchemaStability(currentNames: string[], knownNames: string[]): number {
  if (knownNames.length === 0) return 100;
  if (currentNames.length === 0) return 0;

  const knownSet = new Set(knownNames);
  const unchanged = currentNames.filter((n) => knownSet.has(n)).length;
  return Math.round((unchanged / Math.max(currentNames.length, knownNames.length)) * 10000) / 100;
}

/**
 * Find attribute names that appear in current set but not in the known baseline.
 *
 * @param currentNames - Attribute names observed in this sync
 * @param knownNames - Previously known attribute names
 * @returns Array of new (previously unseen) attribute names
 */
export function detectNewAttributes(currentNames: string[], knownNames: string[]): string[] {
  if (knownNames.length === 0) return [];
  const knownSet = new Set(knownNames);
  return currentNames.filter((n) => !knownSet.has(n));
}

/**
 * Compute Z-score: how many standard deviations a value is from the mean.
 *
 * @param value - Observed value
 * @param mean - Historical mean
 * @param stdDev - Historical standard deviation
 * @returns Z-score (0 when stdDev is 0)
 */
export function computeZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ─── SyncQualityMonitor ───────────────────────────────────────────────────────

type MetricRow = {
  id: string;
  sync_id: string;
  connector_id: string;
  workspace_id: string;
  entity_count: number;
  completeness_pct: string;
  unique_value_ratio: string;
  schema_stability_pct: string;
  anomaly_flags: string[];
  attribute_names: string[];
  recorded_at: Date;
};

type ThresholdRow = {
  entity_count_zscore_threshold: string;
  completeness_drop_threshold: string;
};

/**
 * Monitors connector sync quality over time and detects anomalies.
 * Lightweight — only runs after sync completion, not in the hot path.
 */
export class SyncQualityMonitor {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Record quality metrics for a completed sync run.
   * Automatically computes missing metrics when entities are provided.
   *
   * @param syncId - Unique ID of the sync run
   * @param connectorId - Connector instance ID
   * @param workspaceId - Tenant workspace ID
   * @param input - Metrics or raw entities for auto-computation
   * @returns Result with the stored record ID
   */
  async recordSyncMetrics(
    syncId: string,
    connectorId: string,
    workspaceId: string,
    input: SyncQualityInput,
  ): Promise<Result<string, Error>> {
    try {
      const completenessePct =
        input.completenessePct ??
        (input.entities ? computeCompleteness(input.entities) : 0);

      const uniqueValueRatio =
        input.uniqueValueRatio ??
        (input.entities ? computeUniqueValueRatio(input.entities) : 0);

      const attributeNames =
        input.attributeNames ??
        (input.entities ? extractAttributeNames(input.entities) : []);

      const schemaStabilityPct =
        input.schemaStabilityPct ??
        computeSchemaStability(attributeNames, input.knownAttributeNames ?? []);

      const rows = await this.sql<Array<{ id: string }>>`
        INSERT INTO sync_quality_metrics
          (sync_id, connector_id, workspace_id, entity_count,
           completeness_pct, unique_value_ratio, schema_stability_pct,
           anomaly_flags, attribute_names)
        VALUES
          (${syncId}, ${connectorId}, ${workspaceId}, ${input.entityCount},
           ${completenessePct}, ${uniqueValueRatio}, ${schemaStabilityPct},
           ${[] as string[]}, ${attributeNames})
        RETURNING id
      `;

      const id = rows[0]?.id ?? '';
      log.info('Sync quality metrics recorded', { syncId, connectorId, workspaceId, entityCount: input.entityCount });
      return ok(id);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record sync quality metrics', { syncId, connectorId, error: error.message });
      return err(error);
    }
  }

  /**
   * Detect anomalies in the most recent sync by comparing against the 30-day baseline.
   * Uses z-score for entity count deviation and absolute drop detection for completeness.
   *
   * @param connectorId - Connector instance ID
   * @param workspaceId - Tenant workspace ID
   * @returns AnomalyReport with any detected anomalies
   */
  async detectAnomalies(
    connectorId: string,
    workspaceId: string,
  ): Promise<Result<AnomalyReport, Error>> {
    try {
      const thresholds = await this.getThresholds(connectorId, workspaceId);

      const rows = await this.sql<MetricRow[]>`
        SELECT *
        FROM sync_quality_metrics
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND recorded_at >= NOW() - INTERVAL '${this.sql.unsafe(String(BASELINE_WINDOW_DAYS))} days'
        ORDER BY recorded_at DESC
        LIMIT 100
      `;

      if (rows.length === 0) {
        return ok({ connectorId, workspaceId, anomalies: [], detectedAt: new Date() });
      }

      const [latest, ...historical] = rows;
      const anomalies: Anomaly[] = [];

      if (historical.length >= 3) {
        const historicalCounts = historical.map((r) => r.entity_count);
        const mean = computeMean(historicalCounts);
        const stdDev = computeStdDev(historicalCounts, mean);
        const z = computeZScore(latest.entity_count, mean, stdDev);

        if (Math.abs(z) > thresholds.entityCountZscoreThreshold) {
          anomalies.push({
            type: 'entity_count_deviation',
            severity: Math.abs(z) > thresholds.entityCountZscoreThreshold * 1.5 ? 'critical' : 'warning',
            description: `Entity count ${latest.entity_count} deviates ${z.toFixed(2)}σ from baseline mean of ${mean.toFixed(0)}`,
            zScore: z,
            currentValue: latest.entity_count,
            baselineValue: mean,
          });
        }

        const historicalCompleteness = historical.map((r) => Number(r.completeness_pct));
        const baselineCompleteness = computeMean(historicalCompleteness);
        const currentCompleteness = Number(latest.completeness_pct);
        const completenesDrop = (baselineCompleteness - currentCompleteness) / 100;

        if (completenesDrop > thresholds.completenessDropThreshold) {
          anomalies.push({
            type: 'completeness_drop',
            severity: completenesDrop > thresholds.completenessDropThreshold * 2 ? 'critical' : 'warning',
            description: `Attribute completeness dropped ${(completenesDrop * 100).toFixed(1)}% from baseline ${baselineCompleteness.toFixed(1)}% to ${currentCompleteness.toFixed(1)}%`,
            currentValue: currentCompleteness,
            baselineValue: baselineCompleteness,
          });
        }
      }

      const knownNames = historical[0]?.attribute_names ?? [];
      const currentNames = latest.attribute_names ?? [];
      const newAttrs = detectNewAttributes(currentNames, knownNames);

      if (newAttrs.length > 0) {
        anomalies.push({
          type: 'schema_drift',
          severity: 'warning',
          description: `Schema drift detected: ${newAttrs.length} new attribute(s) appeared: ${newAttrs.join(', ')}`,
          newAttributes: newAttrs,
        });
      }

      if (anomalies.length > 0) {
        const flags = anomalies.map((a) => a.type);
        await this.sql`
          UPDATE sync_quality_metrics
          SET anomaly_flags = ${flags}
          WHERE id = ${latest.id}
        `.catch((e) => log.warn('Failed to update anomaly flags', { error: String(e) }));
      }

      log.info('Anomaly detection complete', {
        connectorId,
        workspaceId,
        anomalyCount: anomalies.length,
      });

      return ok({ connectorId, workspaceId, anomalies, detectedAt: new Date() });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Anomaly detection failed', { connectorId, error: error.message });
      return err(error);
    }
  }

  /**
   * Return quality trend data for a connector over the specified window.
   * Includes per-sync data points and a computed summary trend.
   *
   * @param connectorId - Connector instance ID
   * @param workspaceId - Tenant workspace ID
   * @param windowDays - Days of history to include (default: 30)
   * @returns DataQualityTrend with time-series data and trend summary
   */
  async trackDataQualityTrend(
    connectorId: string,
    workspaceId: string,
    windowDays = 30,
  ): Promise<Result<DataQualityTrend, Error>> {
    try {
      const rows = await this.sql<MetricRow[]>`
        SELECT *
        FROM sync_quality_metrics
        WHERE connector_id = ${connectorId}
          AND workspace_id = ${workspaceId}
          AND recorded_at >= NOW() - INTERVAL '${this.sql.unsafe(String(windowDays))} days'
        ORDER BY recorded_at ASC
      `;

      const dataPoints: TrendPoint[] = rows.map((r) => ({
        syncId: r.sync_id,
        recordedAt: r.recorded_at,
        entityCount: r.entity_count,
        completenessePct: Number(r.completeness_pct),
        schemaStabilityPct: Number(r.schema_stability_pct),
        anomalyFlags: r.anomaly_flags ?? [],
      }));

      const summary = computeTrendSummary(dataPoints);

      return ok({ connectorId, workspaceId, windowDays, dataPoints, summary });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to compute quality trend', { connectorId, error: error.message });
      return err(error);
    }
  }

  /**
   * Update anomaly detection thresholds for a connector.
   *
   * @param connectorId - Connector instance ID
   * @param workspaceId - Tenant workspace ID
   * @param thresholds - New threshold values
   */
  async configureThresholds(
    connectorId: string,
    workspaceId: string,
    thresholds: Partial<QualityThresholds>,
  ): Promise<Result<void, Error>> {
    try {
      const zThreshold = thresholds.entityCountZscoreThreshold ?? DEFAULT_THRESHOLDS.entityCountZscoreThreshold;
      const dropThreshold = thresholds.completenessDropThreshold ?? DEFAULT_THRESHOLDS.completenessDropThreshold;

      await this.sql`
        INSERT INTO sync_quality_thresholds
          (workspace_id, connector_id, entity_count_zscore_threshold, completeness_drop_threshold)
        VALUES (${workspaceId}, ${connectorId}, ${zThreshold}, ${dropThreshold})
        ON CONFLICT (workspace_id, connector_id)
        DO UPDATE SET
          entity_count_zscore_threshold = EXCLUDED.entity_count_zscore_threshold,
          completeness_drop_threshold   = EXCLUDED.completeness_drop_threshold,
          updated_at                    = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(error);
    }
  }

  private async getThresholds(connectorId: string, workspaceId: string): Promise<QualityThresholds> {
    try {
      const rows = await this.sql<ThresholdRow[]>`
        SELECT entity_count_zscore_threshold, completeness_drop_threshold
        FROM sync_quality_thresholds
        WHERE workspace_id = ${workspaceId} AND connector_id = ${connectorId}
        LIMIT 1
      `;

      if (rows.length === 0) return DEFAULT_THRESHOLDS;

      return {
        entityCountZscoreThreshold: Number(rows[0]!.entity_count_zscore_threshold),
        completenessDropThreshold: Number(rows[0]!.completeness_drop_threshold),
      };
    } catch {
      return DEFAULT_THRESHOLDS;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAttributeNames(entities: SemanticEntity[]): string[] {
  const names = new Set<string>();
  for (const entity of entities) {
    for (const key of Object.keys(entity.attributes)) {
      names.add(key);
    }
  }
  return [...names].sort();
}

function computeTrendSummary(points: TrendPoint[]): DataQualityTrend['summary'] {
  const hasRecentAnomaly = points.slice(-3).some((p) => p.anomalyFlags.length > 0);

  if (points.length < 3) {
    return { entityCountTrend: 'stable', completenessTrend: 'stable', hasRecentAnomaly };
  }

  const first = points.slice(0, Math.ceil(points.length / 3));
  const last = points.slice(-Math.ceil(points.length / 3));

  const firstMeanCount = computeMean(first.map((p) => p.entityCount));
  const lastMeanCount = computeMean(last.map((p) => p.entityCount));
  const countDelta = firstMeanCount > 0 ? (lastMeanCount - firstMeanCount) / firstMeanCount : 0;

  const entityCountTrend: DataQualityTrend['summary']['entityCountTrend'] =
    countDelta > 0.1 ? 'growing' : countDelta < -0.1 ? 'declining' : 'stable';

  const firstMeanComp = computeMean(first.map((p) => p.completenessePct));
  const lastMeanComp = computeMean(last.map((p) => p.completenessePct));
  const compDelta = lastMeanComp - firstMeanComp;

  const completenessTrend: DataQualityTrend['summary']['completenessTrend'] =
    compDelta > 5 ? 'improving' : compDelta < -5 ? 'degrading' : 'stable';

  return { entityCountTrend, completenessTrend, hasRecentAnomaly };
}
