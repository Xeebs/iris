import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'webhook-reliability' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetryPolicy = {
  maxAttempts: number;
  backoffMs: number[];
};

export type WebhookAttempt = {
  attemptNumber: number;
  occurredAt: Date;
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number | null;
};

export type DlqEvent = {
  id: string;
  workspaceId: string;
  endpoint: string;
  eventType: string;
  payload: unknown;
  finalError: string;
  attempts: WebhookAttempt[];
  failedAt: Date;
  replayedAt: Date | null;
  replayedBy: string | null;
};

export type DlqPattern = {
  pattern: 'endpoint_unreachable' | 'payload_rejected' | 'auth_failure' | 'timeout' | 'unknown';
  count: number;
  affectedEndpoints: string[];
  suggestion: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Standard exponential backoff delays (ms): 1s, 4s, 16s, 64s, 256s */
export const DEFAULT_RETRY_BACKOFF_MS = [1000, 4000, 16000, 64000, 256000];

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  backoffMs: DEFAULT_RETRY_BACKOFF_MS,
};

/**
 * Compute the delay in ms before the next retry attempt.
 * Returns null if max attempts exceeded.
 */
export function nextRetryDelay(
  attemptNumber: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number | null {
  if (attemptNumber >= policy.maxAttempts) return null;
  return policy.backoffMs[attemptNumber] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 60000;
}

/**
 * Classify an error message into a DLQ pattern category.
 */
export function classifyError(errorMessage: string, httpStatus: number | null): DlqPattern['pattern'] {
  if (httpStatus === 401 || httpStatus === 403 || /auth|token|forbidden|unauthorized/i.test(errorMessage)) {
    return 'auth_failure';
  }
  if (httpStatus === 400 || httpStatus === 422 || /schema|invalid|malformed|parse/i.test(errorMessage)) {
    return 'payload_rejected';
  }
  if (/timeout|ETIMEDOUT|timed out/i.test(errorMessage) || httpStatus === 408 || httpStatus === 504) {
    return 'timeout';
  }
  if (/ECONNREFUSED|ENOTFOUND|unreachable|network|connection/i.test(errorMessage) || httpStatus === 502 || httpStatus === 503) {
    return 'endpoint_unreachable';
  }
  return 'unknown';
}

const PATTERN_SUGGESTIONS: Record<DlqPattern['pattern'], string> = {
  endpoint_unreachable: 'Check endpoint URL and network connectivity. Consider using a retry proxy.',
  payload_rejected: 'Verify your webhook payload schema matches the consumer endpoint expectations.',
  auth_failure: 'Rotate or refresh the authentication credentials for the webhook endpoint.',
  timeout: 'Increase the endpoint response timeout or optimize the consumer handler.',
  unknown: 'Review the error logs for the webhook endpoint for more details.',
};

/**
 * Analyze a set of DLQ events and identify systemic patterns.
 */
export function analyzeDlqPatterns(events: DlqEvent[]): DlqPattern[] {
  const byPattern = new Map<DlqPattern['pattern'], { count: number; endpoints: Set<string> }>();

  for (const ev of events) {
    const lastAttempt = ev.attempts[ev.attempts.length - 1];
    const pattern = classifyError(ev.finalError, lastAttempt?.httpStatus ?? null);
    const entry = byPattern.get(pattern) ?? { count: 0, endpoints: new Set() };
    entry.count++;
    entry.endpoints.add(ev.endpoint);
    byPattern.set(pattern, entry);
  }

  return [...byPattern.entries()].map(([pattern, data]) => ({
    pattern,
    count: data.count,
    affectedEndpoints: [...data.endpoints],
    suggestion: PATTERN_SUGGESTIONS[pattern],
  }));
}

// ─── WebhookReliabilityManager ────────────────────────────────────────────────

export class WebhookReliabilityManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Record a failed webhook delivery attempt in the retry log.
   */
  async recordAttempt(
    webhookId: string,
    workspaceId: string,
    attemptNumber: number,
    httpStatus: number | null,
    errorMessage: string | null,
    durationMs: number | null,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO webhook_retry_log
          (webhook_id, workspace_id, attempt_number, http_status, error_message, duration_ms)
        VALUES (${webhookId}, ${workspaceId}, ${attemptNumber}, ${httpStatus}, ${errorMessage}, ${durationMs})
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Move a webhook to the DLQ after all retry attempts are exhausted.
   */
  async markFailed(
    workspaceId: string,
    endpoint: string,
    eventType: string,
    payload: unknown,
    finalError: string,
  ): Promise<Result<DlqEvent, Error>> {
    const id = randomUUID();
    try {
      const [row] = await this.sql<{ id: string; failed_at: Date }[]>`
        INSERT INTO webhook_dlq
          (id, workspace_id, endpoint, event_type, payload, final_error)
        VALUES
          (${id}, ${workspaceId}, ${endpoint}, ${eventType}, ${JSON.stringify(payload)}, ${finalError})
        RETURNING id, failed_at
      `;
      log.warn('Webhook moved to DLQ', { id, workspaceId, endpoint, eventType });
      return ok({
        id,
        workspaceId,
        endpoint,
        eventType,
        payload,
        finalError,
        attempts: [],
        failedAt: row!.failed_at,
        replayedAt: null,
        replayedBy: null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List DLQ events for a workspace with cursor-based pagination.
   */
  async listDlq(workspaceId: string, limit = 50, cursor?: string): Promise<Result<{ events: DlqEvent[]; nextCursor: string | null }, Error>> {
    try {
      const cursorDate = cursor ? new Date(Buffer.from(cursor, 'base64url').toString()) : new Date();
      type DlqRow = { id: string; endpoint: string; event_type: string; payload: unknown; final_error: string; failed_at: Date; replayed_at: Date | null; replayed_by: string | null };
      const rows = await this.sql<DlqRow[]>`
        SELECT id, endpoint, event_type, payload, final_error, failed_at, replayed_at, replayed_by
        FROM webhook_dlq
        WHERE workspace_id = ${workspaceId} AND failed_at < ${cursorDate.toISOString()}
        ORDER BY failed_at DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const events = rows.slice(0, limit);
      const nextCursor = hasMore ? Buffer.from(events[events.length - 1]!.failed_at.toISOString()).toString('base64url') : null;

      return ok({
        events: events.map((r) => ({
          id: r.id,
          workspaceId,
          endpoint: r.endpoint,
          eventType: r.event_type,
          payload: r.payload,
          finalError: r.final_error,
          attempts: [],
          failedAt: r.failed_at,
          replayedAt: r.replayed_at,
          replayedBy: r.replayed_by,
        })),
        nextCursor,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Mark a DLQ event as replayed.
   */
  async markReplayed(eventId: string, workspaceId: string, replayedBy: string): Promise<Result<boolean, Error>> {
    try {
      const rows = await this.sql<{ id: string }[]>`
        UPDATE webhook_dlq
        SET replayed_at = NOW(), replayed_by = ${replayedBy}
        WHERE id = ${eventId} AND workspace_id = ${workspaceId} AND replayed_at IS NULL
        RETURNING id
      `;
      return ok(rows.length > 0);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Analyze DLQ patterns for a workspace.
   */
  async analyzePatterns(workspaceId: string): Promise<Result<DlqPattern[], Error>> {
    try {
      type DlqRow = { id: string; endpoint: string; event_type: string; payload: unknown; final_error: string; failed_at: Date; replayed_at: Date | null; replayed_by: string | null };
      const rows = await this.sql<DlqRow[]>`
        SELECT id, endpoint, event_type, payload, final_error, failed_at, replayed_at, replayed_by
        FROM webhook_dlq
        WHERE workspace_id = ${workspaceId} AND replayed_at IS NULL
        ORDER BY failed_at DESC
        LIMIT 500
      `;
      const events: DlqEvent[] = rows.map((r) => ({
        id: r.id, workspaceId, endpoint: r.endpoint, eventType: r.event_type, payload: r.payload,
        finalError: r.final_error, attempts: [], failedAt: r.failed_at, replayedAt: r.replayed_at, replayedBy: r.replayed_by,
      }));
      return ok(analyzeDlqPatterns(events));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Purge DLQ events older than retentionDays. */
  async pruneOldEvents(workspaceId: string, retentionDays = 30): Promise<Result<number, Error>> {
    try {
      const rows = await this.sql<{ id: string }[]>`
        DELETE FROM webhook_dlq
        WHERE workspace_id = ${workspaceId}
          AND failed_at < NOW() - ${retentionDays} * INTERVAL '1 day'
        RETURNING id
      `;
      return ok(rows.length);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
