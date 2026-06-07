import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'performance-profiler' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperationLabel =
  | 'connector_sync'
  | 'semantic_indexing'
  | 'vector_search'
  | 'cache_read'
  | 'cache_write'
  | 'embedding_generate'
  | 'mcp_tool_call'
  | 'graph_query';

export type LatencyPercentiles = {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
};

export type OperationStats = {
  operation: OperationLabel;
  connectorId: string | null;
  workspaceId: string | null;
  percentiles: LatencyPercentiles;
  windowStart: Date;
};

export type ProfilerRecord = {
  operation: OperationLabel;
  connectorId: string | null;
  workspaceId: string | null;
  durationMs: number;
  success: boolean;
  recordedAt: Date;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ─── PerformanceProfiler ──────────────────────────────────────────────────────

/**
 * Records per-operation latency samples and computes p50/p95/p99 percentiles.
 * Exposes a Prometheus-compatible metrics text endpoint via `formatPrometheus()`.
 */
export class PerformanceProfiler {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Record a single latency sample for an operation.
   *
   * @param operation - The labelled operation
   * @param durationMs - Elapsed time in milliseconds
   * @param success - Whether the operation succeeded
   * @param workspaceId - Optional tenant workspace
   * @param connectorId - Optional connector instance
   */
  async record(
    operation: OperationLabel,
    durationMs: number,
    success: boolean,
    workspaceId?: string,
    connectorId?: string,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO performance_samples (operation, connector_id, workspace_id, duration_ms, success)
        VALUES (
          ${operation},
          ${connectorId ?? null},
          ${workspaceId ?? null},
          ${durationMs},
          ${success}
        )
      `;
      return ok(undefined);
    } catch (e) {
      log.warn('Failed to record performance sample', { operation, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute latency percentiles for all operations in the last `windowMinutes`.
   *
   * @param workspaceId - Filter to a specific workspace (optional)
   * @param windowMinutes - Lookback window (default: 60)
   * @returns Per-operation percentile stats
   */
  async getStats(
    workspaceId?: string,
    windowMinutes = 60,
  ): Promise<Result<OperationStats[], Error>> {
    try {
      const rows = workspaceId
        ? await this.sql`
            SELECT operation, connector_id, workspace_id, duration_ms
            FROM performance_samples
            WHERE workspace_id = ${workspaceId}
              AND recorded_at >= now() - (${windowMinutes} || ' minutes')::INTERVAL
              AND success = true
            ORDER BY operation, duration_ms
          ` as { operation: OperationLabel; connector_id: string | null; workspace_id: string | null; duration_ms: number }[]
        : await this.sql`
            SELECT operation, connector_id, workspace_id, duration_ms
            FROM performance_samples
            WHERE recorded_at >= now() - (${windowMinutes} || ' minutes')::INTERVAL
              AND success = true
            ORDER BY operation, duration_ms
          ` as { operation: OperationLabel; connector_id: string | null; workspace_id: string | null; duration_ms: number }[];

      // Group by (operation, connectorId)
      const grouped = new Map<string, { op: OperationLabel; connId: string | null; wsId: string | null; durations: number[] }>();
      for (const r of rows) {
        const key = `${r.operation}::${r.connector_id ?? ''}`;
        let g = grouped.get(key);
        if (!g) {
          g = { op: r.operation, connId: r.connector_id, wsId: r.workspace_id, durations: [] };
          grouped.set(key, g);
        }
        g.durations.push(r.duration_ms);
      }

      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
      const stats: OperationStats[] = [];
      for (const g of grouped.values()) {
        const sorted = [...g.durations].sort((a, b) => a - b);
        stats.push({
          operation: g.op,
          connectorId: g.connId,
          workspaceId: g.wsId,
          percentiles: {
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
            p99: percentile(sorted, 99),
            min: sorted[0] ?? 0,
            max: sorted[sorted.length - 1] ?? 0,
            count: sorted.length,
          },
          windowStart,
        });
      }

      return ok(stats.sort((a, b) => b.percentiles.p95 - a.percentiles.p95));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns p95 latencies per connector for the last `windowMinutes`.
   * Used to highlight slow connectors in the dashboard.
   *
   * @param workspaceId - Tenant workspace
   * @param windowMinutes - Lookback window (default: 60)
   */
  async getConnectorBreakdown(
    workspaceId: string,
    windowMinutes = 60,
  ): Promise<Result<{ connectorId: string; p95Ms: number; sampleCount: number }[], Error>> {
    try {
      const rows = await this.sql`
        SELECT
          connector_id,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
          COUNT(*)::int AS sample_count
        FROM performance_samples
        WHERE workspace_id = ${workspaceId}
          AND connector_id IS NOT NULL
          AND recorded_at >= now() - (${windowMinutes} || ' minutes')::INTERVAL
          AND success = true
        GROUP BY connector_id
        ORDER BY p95_ms DESC
        LIMIT 20
      ` as { connector_id: string; p95_ms: number; sample_count: number }[];
      return ok(rows.map((r) => ({ connectorId: r.connector_id, p95Ms: r.p95_ms, sampleCount: r.sample_count })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Format current stats as a Prometheus metrics text block.
   * Compatible with the Prometheus text-based exposition format (version 0.0.4).
   *
   * @param workspaceId - Optional workspace filter
   */
  async formatPrometheus(workspaceId?: string): Promise<Result<string, Error>> {
    const statsResult = await this.getStats(workspaceId);
    if (statsResult.isErr()) return err(statsResult.error);
    const stats = statsResult.value;

    const lines: string[] = [
      '# HELP iris_operation_duration_ms Operation latency percentiles (ms)',
      '# TYPE iris_operation_duration_ms gauge',
    ];

    for (const s of stats) {
      const labels = [
        `operation="${s.operation}"`,
        ...(s.connectorId ? [`connector_id="${s.connectorId}"`] : []),
        ...(s.workspaceId ? [`workspace_id="${s.workspaceId}"`] : []),
      ].join(',');
      lines.push(`iris_operation_duration_ms{${labels},quantile="0.50"} ${s.percentiles.p50}`);
      lines.push(`iris_operation_duration_ms{${labels},quantile="0.95"} ${s.percentiles.p95}`);
      lines.push(`iris_operation_duration_ms{${labels},quantile="0.99"} ${s.percentiles.p99}`);
    }

    lines.push('');
    lines.push('# HELP iris_operation_total Total operation count in current window');
    lines.push('# TYPE iris_operation_total counter');
    for (const s of stats) {
      const labels = [
        `operation="${s.operation}"`,
        ...(s.connectorId ? [`connector_id="${s.connectorId}"`] : []),
      ].join(',');
      lines.push(`iris_operation_total{${labels}} ${s.percentiles.count}`);
    }

    return ok(lines.join('\n') + '\n');
  }

  /**
   * Prune samples older than `retentionDays` to keep the table bounded.
   *
   * @param retentionDays - Delete samples older than this (default: 7)
   */
  async pruneOldSamples(retentionDays = 7): Promise<void> {
    try {
      await this.sql`
        DELETE FROM performance_samples
        WHERE recorded_at < now() - (${retentionDays} || ' days')::INTERVAL
      `;
    } catch {
      log.warn('Failed to prune performance samples (non-fatal)');
    }
  }
}
