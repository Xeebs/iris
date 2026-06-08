import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'slo-monitor' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SloSeverity = 'warning' | 'critical';

export type SloDefinition = {
  name: string;
  workspaceId: string;
  metric: string;
  /** Target attainment 0–1. e.g. 0.99 = 99% */
  target: number;
  /** Rolling window in hours for attainment calculation */
  windowHours: number;
  severity: SloSeverity;
  active: boolean;
};

export type SloEvent = {
  sloName: string;
  workspaceId: string;
  metricValue: number;
  met: boolean;
  recordedAt: Date;
};

export type SloAttainment = {
  sloName: string;
  metric: string;
  target: number;
  attainmentPct: number;
  totalEvents: number;
  metEvents: number;
  windowHours: number;
  status: 'ok' | 'warning' | 'breached';
};

export type SloViolation = {
  id: number;
  sloName: string;
  workspaceId: string;
  attainmentPct: number;
  targetPct: number;
  severity: SloSeverity;
  correctiveHint: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
};

// ─── Built-in SLOs ────────────────────────────────────────────────────────────

export const BUILT_IN_SLOS: Omit<SloDefinition, 'workspaceId'>[] = [
  { name: 'mcp-query-latency-p95', metric: 'mcp_query_latency_p95_ms', target: 0.99, windowHours: 24, severity: 'critical', active: true },
  { name: 'api-availability', metric: 'api_success_rate', target: 0.999, windowHours: 24, severity: 'critical', active: true },
  { name: 'connector-sync-success', metric: 'sync_success_rate', target: 0.95, windowHours: 24, severity: 'warning', active: true },
  { name: 'index-freshness', metric: 'index_freshness_hours', target: 0.95, windowHours: 24, severity: 'warning', active: true },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Calculate the percentage of events where `met === true`.
 */
export function computeAttainment(events: Pick<SloEvent, 'met'>[]): number {
  if (events.length === 0) return 1; // no data → assume SLO is met
  return events.filter((e) => e.met).length / events.length;
}

/**
 * Determine SLO status from attainment vs target.
 * Below 95% of target → breached; 95–100% of target → warning; at or above → ok.
 */
export function computeSloStatus(attainment: number, target: number): 'ok' | 'warning' | 'breached' {
  if (attainment >= target) return 'ok';
  if (attainment >= target * 0.95) return 'warning';
  return 'breached';
}

/**
 * Suggest a corrective action based on which SLO metric is violated.
 */
export function suggestCorrectiveAction(metric: string, attainment: number): string {
  if (metric.includes('latency')) {
    return attainment < 0.9
      ? 'Increase semantic cache TTL and check vector-store index health'
      : 'Review recent slow queries in the audit log';
  }
  if (metric.includes('availability') || metric.includes('success_rate')) {
    return 'Check API error logs, circuit breaker states, and connector health';
  }
  if (metric.includes('sync')) {
    return 'Review connector circuit breaker states and external API rate limits';
  }
  if (metric.includes('freshness')) {
    return 'Verify sync scheduler is running and connector quotas are not exhausted';
  }
  return 'Review system logs and metrics for the affected service';
}

// ─── SloService ───────────────────────────────────────────────────────────────

export class SloService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Upsert an SLO definition.
   */
  async defineSlo(definition: SloDefinition): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO slo_definitions
          (name, workspace_id, metric, target, window_hours, severity, active)
        VALUES (
          ${definition.name}, ${definition.workspaceId}, ${definition.metric},
          ${definition.target}, ${definition.windowHours}, ${definition.severity}, ${definition.active}
        )
        ON CONFLICT (name, workspace_id) DO UPDATE SET
          metric = EXCLUDED.metric,
          target = EXCLUDED.target,
          window_hours = EXCLUDED.window_hours,
          severity = EXCLUDED.severity,
          active = EXCLUDED.active
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a metric observation for an SLO.
   *
   * @param sloName      - SLO name
   * @param workspaceId  - Workspace
   * @param metricValue  - Observed metric value
   * @param met          - Whether the SLO target was met for this observation
   */
  async recordEvent(
    sloName: string,
    workspaceId: string,
    metricValue: number,
    met: boolean,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO slo_events (slo_name, workspace_id, metric_value, met)
        VALUES (${sloName}, ${workspaceId}, ${metricValue}, ${met})
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Calculate attainment for all active SLOs in a workspace.
   */
  async calculateAttainments(workspaceId: string): Promise<Result<SloAttainment[], Error>> {
    try {
      type DefRow = { name: string; metric: string; target: string; window_hours: number; severity: SloSeverity };
      const defs = await this.sql<DefRow[]>`
        SELECT name, metric, target, window_hours, severity
        FROM slo_definitions
        WHERE workspace_id = ${workspaceId} AND active = TRUE
        ORDER BY name
      `;

      const attainments: SloAttainment[] = [];

      for (const def of defs) {
        type EventRow = { met: boolean };
        const events = await this.sql<EventRow[]>`
          SELECT met FROM slo_events
          WHERE slo_name = ${def.name} AND workspace_id = ${workspaceId}
            AND recorded_at > NOW() - ${def.window_hours} * INTERVAL '1 hour'
        `;

        const attainmentPct = computeAttainment(events);
        const target = parseFloat(String(def.target));
        attainments.push({
          sloName: def.name,
          metric: def.metric,
          target,
          attainmentPct,
          totalEvents: events.length,
          metEvents: events.filter((e) => e.met).length,
          windowHours: def.window_hours,
          status: computeSloStatus(attainmentPct, target),
        });
      }

      return ok(attainments);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Detect SLO violations by comparing current attainments against targets.
   * Opens new violation records and resolves existing ones as appropriate.
   */
  async detectViolations(workspaceId: string): Promise<Result<SloViolation[], Error>> {
    const attainmentsResult = await this.calculateAttainments(workspaceId);
    if (attainmentsResult.isErr()) return err(attainmentsResult.error);

    const violations: SloViolation[] = [];

    for (const att of attainmentsResult.value) {
      if (att.status === 'breached' || att.status === 'warning') {
        const hint = suggestCorrectiveAction(att.metric, att.attainmentPct);
        try {
          const [row] = await this.sql<{ id: number; started_at: Date }[]>`
            INSERT INTO slo_violations
              (slo_name, workspace_id, attainment_pct, target_pct, severity, corrective_hint)
            VALUES (
              ${att.sloName}, ${workspaceId},
              ${att.attainmentPct * 100},
              ${att.target * 100},
              ${att.status === 'breached' ? 'critical' : 'warning'},
              ${hint}
            )
            RETURNING id, started_at
          `;
          if (row) {
            violations.push({
              id: row.id,
              sloName: att.sloName,
              workspaceId,
              attainmentPct: att.attainmentPct * 100,
              targetPct: att.target * 100,
              severity: att.status === 'breached' ? 'critical' : 'warning',
              correctiveHint: hint,
              startedAt: row.started_at,
              resolvedAt: null,
            });
            log.warn('SLO violation detected', { sloName: att.sloName, attainmentPct: att.attainmentPct, target: att.target });
          }
        } catch (e) {
          log.error('Failed to record SLO violation', { sloName: att.sloName, error: e });
        }
      }
    }

    return ok(violations);
  }

  /**
   * List historical violations for a workspace.
   */
  async listViolations(workspaceId: string, limit = 50): Promise<Result<SloViolation[], Error>> {
    try {
      type Row = {
        id: number; slo_name: string; workspace_id: string;
        attainment_pct: number; target_pct: number; severity: SloSeverity;
        corrective_hint: string | null; started_at: Date; resolved_at: Date | null;
      };
      const rows = await this.sql<Row[]>`
        SELECT id, slo_name, workspace_id, attainment_pct, target_pct, severity,
               corrective_hint, started_at, resolved_at
        FROM slo_violations
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
      return ok(rows.map((r) => ({
        id: r.id,
        sloName: r.slo_name,
        workspaceId: r.workspace_id,
        attainmentPct: r.attainment_pct,
        targetPct: r.target_pct,
        severity: r.severity,
        correctiveHint: r.corrective_hint,
        startedAt: r.started_at,
        resolvedAt: r.resolved_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
