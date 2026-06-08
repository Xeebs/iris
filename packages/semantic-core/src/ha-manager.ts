import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'ha-manager' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegionRole = 'primary' | 'replica';
export type HealthStatus = 'healthy' | 'degraded' | 'unreachable';
export type FailoverReason = 'manual' | 'health_check_failure' | 'replication_lag_exceeded';

export type RegionConfig = {
  regionId: string;
  role: RegionRole;
  postgresUrl: string;
  replicationLagThresholdMs: number;
  healthCheckIntervalMs: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ReplicationStatus = {
  regionId: string;
  primaryRegionId: string;
  lagMs: number | null;
  lastSyncAt: Date | null;
  status: HealthStatus;
  checkedAt: Date;
};

export type FailoverEvent = {
  id: string;
  fromRegion: string;
  toRegion: string;
  reason: FailoverReason;
  lagAtFailoverMs: number | null;
  durationMs: number | null;
  initiatedBy: string;
  occurredAt: Date;
};

export type HaStatus = {
  primaryRegion: RegionConfig | null;
  replicaRegions: ReplicationStatus[];
  lastFailover: FailoverEvent | null;
  overallStatus: HealthStatus;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Determine if a replication lag value exceeds the configured threshold.
 */
export function isLagExceeded(lagMs: number | null, thresholdMs: number): boolean {
  if (lagMs === null) return false; // unknown lag — don't fail over
  return lagMs > thresholdMs;
}

/**
 * Compute overall HA status from the set of region statuses.
 */
export function computeOverallStatus(regions: ReplicationStatus[]): HealthStatus {
  if (regions.length === 0) return 'healthy'; // no replicas = standalone, assume healthy
  const anyUnreachable = regions.some((r) => r.status === 'unreachable');
  if (anyUnreachable) return 'degraded';
  const allDegraded = regions.every((r) => r.status === 'degraded');
  if (allDegraded) return 'degraded';
  return 'healthy';
}

/**
 * Select the best replica for promotion: lowest lag among healthy replicas.
 */
export function selectPromotionCandidate(
  replicas: ReplicationStatus[],
  maxLagMs: number,
): ReplicationStatus | null {
  const eligible = replicas
    .filter((r) => r.status !== 'unreachable' && (r.lagMs === null || r.lagMs <= maxLagMs))
    .sort((a, b) => (a.lagMs ?? Infinity) - (b.lagMs ?? Infinity));
  return eligible[0] ?? null;
}

/**
 * Format replication lag for display.
 */
export function formatLag(lagMs: number | null): string {
  if (lagMs === null) return 'unknown';
  if (lagMs < 1000) return `${lagMs}ms`;
  return `${(lagMs / 1000).toFixed(1)}s`;
}

// ─── HaManager ───────────────────────────────────────────────────────────────

export class HaManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Get current HA status: primary config, replica statuses, last failover.
   */
  async getStatus(workspaceId: string): Promise<Result<HaStatus, Error>> {
    try {
      type ConfigRow = RegionConfig & { region_id: string; postgres_url: string; replication_lag_threshold_ms: number; health_check_interval_ms: number; created_at: Date; updated_at: Date };
      const configs = await this.sql<ConfigRow[]>`
        SELECT region_id AS "regionId", role, postgres_url AS "postgresUrl",
               replication_lag_threshold_ms AS "replicationLagThresholdMs",
               health_check_interval_ms AS "healthCheckIntervalMs",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM region_config
        WHERE workspace_id = ${workspaceId}
      `;

      const primary = configs.find((c) => c.role === 'primary') ?? null;

      type StatusRow = { region_id: string; primary_region_id: string; lag_ms: number | null; last_sync_at: Date | null; status: string; checked_at: Date };
      const statuses = await this.sql<StatusRow[]>`
        SELECT region_id, primary_region_id, lag_ms, last_sync_at, status, checked_at
        FROM replication_status
        WHERE workspace_id = ${workspaceId}
        ORDER BY checked_at DESC
      `;

      type EventRow = { id: string; from_region: string; to_region: string; reason: string; lag_at_failover_ms: number | null; duration_ms: number | null; initiated_by: string; occurred_at: Date };
      const [lastFailoverRow] = await this.sql<EventRow[]>`
        SELECT id, from_region, to_region, reason, lag_at_failover_ms, duration_ms,
               initiated_by, occurred_at
        FROM ha_failover_log
        WHERE workspace_id = ${workspaceId}
        ORDER BY occurred_at DESC
        LIMIT 1
      `;

      const replicaStatuses: ReplicationStatus[] = statuses.map((r) => ({
        regionId: r.region_id,
        primaryRegionId: r.primary_region_id,
        lagMs: r.lag_ms,
        lastSyncAt: r.last_sync_at,
        status: r.status as HealthStatus,
        checkedAt: r.checked_at,
      }));

      const lastFailover: FailoverEvent | null = lastFailoverRow
        ? {
            id: lastFailoverRow.id,
            fromRegion: lastFailoverRow.from_region,
            toRegion: lastFailoverRow.to_region,
            reason: lastFailoverRow.reason as FailoverReason,
            lagAtFailoverMs: lastFailoverRow.lag_at_failover_ms,
            durationMs: lastFailoverRow.duration_ms,
            initiatedBy: lastFailoverRow.initiated_by,
            occurredAt: lastFailoverRow.occurred_at,
          }
        : null;

      return ok({
        primaryRegion: primary as RegionConfig | null,
        replicaRegions: replicaStatuses,
        lastFailover,
        overallStatus: computeOverallStatus(replicaStatuses),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a manual or automatic failover event.
   */
  async recordFailover(
    workspaceId: string,
    fromRegion: string,
    toRegion: string,
    reason: FailoverReason,
    initiatedBy: string,
    lagAtFailoverMs: number | null = null,
    durationMs: number | null = null,
  ): Promise<Result<FailoverEvent, Error>> {
    const id = randomUUID();
    try {
      const [row] = await this.sql<{ id: string; occurred_at: Date }[]>`
        INSERT INTO ha_failover_log
          (id, workspace_id, from_region, to_region, reason, lag_at_failover_ms, duration_ms, initiated_by)
        VALUES
          (${id}, ${workspaceId}, ${fromRegion}, ${toRegion}, ${reason},
           ${lagAtFailoverMs}, ${durationMs}, ${initiatedBy})
        RETURNING id, occurred_at
      `;
      log.info('Failover recorded', { fromRegion, toRegion, reason, workspaceId });
      return ok({
        id,
        fromRegion,
        toRegion,
        reason,
        lagAtFailoverMs,
        durationMs,
        initiatedBy,
        occurredAt: row!.occurred_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Update replication status for a replica region.
   */
  async updateReplicationStatus(
    workspaceId: string,
    regionId: string,
    primaryRegionId: string,
    lagMs: number | null,
    status: HealthStatus,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO replication_status
          (workspace_id, region_id, primary_region_id, lag_ms, status, checked_at)
        VALUES
          (${workspaceId}, ${regionId}, ${primaryRegionId}, ${lagMs}, ${status}, NOW())
        ON CONFLICT (workspace_id, region_id) DO UPDATE
        SET lag_ms = EXCLUDED.lag_ms, status = EXCLUDED.status,
            last_sync_at = CASE WHEN EXCLUDED.status = 'healthy' THEN NOW() ELSE replication_status.last_sync_at END,
            checked_at = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List failover history.
   */
  async listFailoverHistory(workspaceId: string, limit = 20): Promise<Result<FailoverEvent[], Error>> {
    try {
      type Row = { id: string; from_region: string; to_region: string; reason: string; lag_at_failover_ms: number | null; duration_ms: number | null; initiated_by: string; occurred_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, from_region, to_region, reason, lag_at_failover_ms, duration_ms,
               initiated_by, occurred_at
        FROM ha_failover_log
        WHERE workspace_id = ${workspaceId}
        ORDER BY occurred_at DESC
        LIMIT ${limit}
      `;
      return ok(rows.map((r) => ({
        id: r.id,
        fromRegion: r.from_region,
        toRegion: r.to_region,
        reason: r.reason as FailoverReason,
        lagAtFailoverMs: r.lag_at_failover_ms,
        durationMs: r.duration_ms,
        initiatedBy: r.initiated_by,
        occurredAt: r.occurred_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
