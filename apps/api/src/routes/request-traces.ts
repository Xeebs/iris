import { Hono } from 'hono';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'request-traces' });
type SqlClient = ReturnType<typeof postgres>;

type TraceSpan = {
  correlationId: string;
  traceId: string;
  spanId: string;
  service: string;
  operation: string;
  startTimeMs: number;
  durationMs: number;
  statusCode?: number;
  metadata: Record<string, unknown>;
};

type TraceEntry = {
  spans: TraceSpan[];
  firstSeen: number;
};

// In-memory TTL store for trace spans (10-minute window)
const TRACE_TTL_MS = 10 * 60 * 1000;

class TraceSpanStore {
  private store = new Map<string, TraceEntry>();
  private lastClean = Date.now();

  record(span: TraceSpan): void {
    const existing = this.store.get(span.correlationId);
    if (existing) {
      existing.spans.push(span);
    } else {
      this.store.set(span.correlationId, { spans: [span], firstSeen: Date.now() });
    }
    this.maybeClean();
  }

  get(correlationId: string): TraceEntry | undefined {
    return this.store.get(correlationId);
  }

  private maybeClean() {
    if (Date.now() - this.lastClean < 60_000) return;
    const cutoff = Date.now() - TRACE_TTL_MS;
    for (const [id, entry] of this.store.entries()) {
      if (entry.firstSeen < cutoff) this.store.delete(id);
    }
    this.lastClean = Date.now();
  }
}

export const traceSpanStore = new TraceSpanStore();

/**
 * Record a span into the global trace store — called from middleware/workers.
 *
 * @param span - Span data to record
 */
export function recordSpan(span: TraceSpan): void {
  traceSpanStore.record(span);
}

/**
 * Routes for distributed request trace exploration.
 * Mounted under /api/v1/admin/request-traces.
 *
 * @param sql - Postgres client (used for audit log correlation)
 * @returns Hono router
 */
export function createRequestTracesRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /api/v1/admin/request-traces/:correlationId — trace timeline for a correlation ID */
  app.get('/:correlationId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { correlationId } = c.req.param();
    if (!correlationId || correlationId.length < 8) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid correlationId' } }, 400);
    }

    const entry = traceSpanStore.get(correlationId);
    const spans = entry?.spans ?? [];

    type AuditRow = {
      id: string;
      action: string;
      actor_id: string | null;
      resource_type: string | null;
      created_at: Date;
      metadata: Record<string, unknown>;
    };

    let auditEvents: AuditRow[] = [];
    try {
      auditEvents = await sql<AuditRow[]>`
        SELECT id, action, actor_id, resource_type, created_at, metadata
        FROM audit_logs
        WHERE workspace_id = ${workspaceId}
          AND metadata->>'correlationId' = ${correlationId}
        ORDER BY created_at ASC
        LIMIT 50
      `;
    } catch (e) {
      log.warn('Audit log query failed for trace', { correlationId, error: String(e) });
    }

    const spanTimeline = spans
      .sort((a, b) => a.startTimeMs - b.startTimeMs)
      .map((s) => ({
        ...s,
        startTime: new Date(s.startTimeMs).toISOString(),
      }));

    const auditTimeline = auditEvents.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actor_id,
      resourceType: r.resource_type,
      timestamp: new Date(r.created_at).toISOString(),
      correlationId: r.metadata['correlationId'] as string | undefined,
    }));

    const allEvents = [
      ...spanTimeline.map((s) => ({ type: 'span' as const, timestamp: s.startTime, data: s })),
      ...auditTimeline.map((a) => ({ type: 'audit' as const, timestamp: a.timestamp, data: a })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const totalDurationMs = spans.length > 0
      ? Math.max(...spans.map((s) => s.startTimeMs + s.durationMs)) - Math.min(...spans.map((s) => s.startTimeMs))
      : null;

    return c.json({
      data: {
        correlationId,
        spanCount: spans.length,
        auditEventCount: auditEvents.length,
        totalDurationMs,
        timeline: allEvents,
      },
    });
  });

  /** GET /api/v1/admin/request-traces — list recent slow requests */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const thresholdMs = parseInt(c.req.query('minDurationMs') ?? '1000', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

    type SlowRow = {
      metadata: Record<string, unknown>;
      created_at: Date;
      action: string;
    };

    let rows: SlowRow[] = [];
    try {
      rows = await sql<SlowRow[]>`
        SELECT metadata, created_at, action
        FROM audit_logs
        WHERE workspace_id = ${workspaceId}
          AND metadata->>'durationMs' IS NOT NULL
          AND (metadata->>'durationMs')::int >= ${thresholdMs}
        ORDER BY (metadata->>'durationMs')::int DESC
        LIMIT ${limit}
      `;
    } catch (e) {
      log.warn('Slow request query failed', { workspaceId, error: String(e) });
    }

    return c.json({
      data: rows.map((r) => ({
        correlationId: r.metadata['correlationId'] as string | null,
        durationMs: r.metadata['durationMs'] as number | null,
        action: r.action,
        timestamp: new Date(r.created_at).toISOString(),
      })),
    });
  });

  return app;
}
