import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'sync-diagnostics' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | 'auth_failure'
  | 'rate_limit'
  | 'network_timeout'
  | 'schema_mismatch'
  | 'data_validation'
  | 'quota_exceeded'
  | 'unknown';

export type RecoverySuggestion = {
  action: string;
  description: string;
  automated: boolean;
};

export type SyncDiagnostic = {
  id: string;
  syncJobId: string;
  connectorInstanceId: string;
  workspaceId: string;
  errorCategory: ErrorCategory;
  errorMessage: string;
  errorDetails: Record<string, unknown>;
  recoverySuggestions: RecoverySuggestion[];
  isResolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type ConnectorHealthPattern = {
  connectorInstanceId: string;
  errorRate: number;
  dominantCategory: ErrorCategory | null;
  patterns: string[];
  healthStatus: 'healthy' | 'degraded' | 'failing';
};

// ─── Error categorization rules ──────────────────────────────────────────────

const AUTH_PATTERNS = [/unauthorized/i, /401/i, /invalid.*token/i, /oauth/i, /credentials?/i, /access.*denied/i];
const RATE_PATTERNS = [/rate.*limit/i, /429/i, /too.*many.*request/i, /throttl/i, /quota.*exceeded/i];
const TIMEOUT_PATTERNS = [/timeout/i, /ETIMEDOUT/i, /ECONNRESET/i, /socket.*hang/i, /network/i];
const SCHEMA_PATTERNS = [/schema/i, /unknown.*field/i, /invalid.*field/i, /column.*not.*found/i, /type.*mismatch/i];
const VALIDATION_PATTERNS = [/validation/i, /invalid.*value/i, /required.*field/i, /format.*error/i];

const RECOVERY_MAP: Record<ErrorCategory, RecoverySuggestion[]> = {
  auth_failure: [
    { action: 'reauthorize', description: 'Re-authorize the connector OAuth connection', automated: false },
    { action: 'refresh_token', description: 'Attempt to refresh the access token', automated: true },
    { action: 'check_scopes', description: 'Verify required OAuth scopes are granted', automated: false },
  ],
  rate_limit: [
    { action: 'wait_retry', description: 'Wait 5 minutes before retrying the sync', automated: true },
    { action: 'reduce_frequency', description: 'Reduce sync frequency to avoid rate limits', automated: false },
    { action: 'check_rate_limits', description: 'Review connector rate limit configuration', automated: false },
  ],
  network_timeout: [
    { action: 'retry_immediately', description: 'Retry the sync immediately', automated: true },
    { action: 'check_connectivity', description: 'Check network connectivity to the external API', automated: false },
    { action: 'increase_timeout', description: 'Increase API timeout setting for this connector', automated: false },
  ],
  schema_mismatch: [
    { action: 'refresh_schema', description: 'Refresh the connector schema definition', automated: true },
    { action: 'update_mappings', description: 'Update field mappings to match the current API schema', automated: false },
  ],
  data_validation: [
    { action: 'review_entity_types', description: 'Review entity type definitions for this connector', automated: false },
    { action: 'skip_invalid', description: 'Enable skip-invalid mode to continue sync with valid records', automated: false },
  ],
  quota_exceeded: [
    { action: 'upgrade_plan', description: 'Consider upgrading to a higher plan for more quota', automated: false },
    { action: 'clean_old_entities', description: 'Archive or remove unused entities to free quota', automated: true },
  ],
  unknown: [
    { action: 'view_logs', description: 'Review raw error logs for more details', automated: false },
    { action: 'contact_support', description: 'Contact support with the error details', automated: false },
  ],
};

// ─── SyncDiagnosticsService ───────────────────────────────────────────────────

/**
 * Categorizes sync errors and generates recovery plans to reduce MTTR.
 */
export class SyncDiagnosticsService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Classify a sync error message into a structured category.
   *
   * @param errorMessage - Raw error message from the sync
   */
  categorizeError(errorMessage: string): ErrorCategory {
    if (AUTH_PATTERNS.some((p) => p.test(errorMessage))) return 'auth_failure';
    if (RATE_PATTERNS.some((p) => p.test(errorMessage))) return 'rate_limit';
    if (TIMEOUT_PATTERNS.some((p) => p.test(errorMessage))) return 'network_timeout';
    if (SCHEMA_PATTERNS.some((p) => p.test(errorMessage))) return 'schema_mismatch';
    if (VALIDATION_PATTERNS.some((p) => p.test(errorMessage))) return 'data_validation';
    return 'unknown';
  }

  /**
   * Generate recovery suggestions for a categorized error.
   *
   * @param category - Classified error category
   */
  generateRecoveryPlan(category: ErrorCategory): RecoverySuggestion[] {
    return RECOVERY_MAP[category] ?? RECOVERY_MAP['unknown'];
  }

  /**
   * Record a sync error to the diagnostics table.
   *
   * @param syncJobId - BullMQ job ID
   * @param connectorInstanceId - Connector instance that failed
   * @param workspaceId - Tenant workspace
   * @param errorMessage - Raw error message
   * @param errorDetails - Additional structured context
   */
  async recordDiagnostic(
    syncJobId: string,
    connectorInstanceId: string,
    workspaceId: string,
    errorMessage: string,
    errorDetails: Record<string, unknown> = {},
  ): Promise<Result<SyncDiagnostic, Error>> {
    const category = this.categorizeError(errorMessage);
    const suggestions = this.generateRecoveryPlan(category);

    try {
      const rows = await this.sql`
        INSERT INTO sync_diagnostics (
          sync_job_id, connector_instance_id, workspace_id,
          error_category, error_message, error_details, recovery_suggestions
        ) VALUES (
          ${syncJobId}, ${connectorInstanceId}, ${workspaceId},
          ${category}, ${errorMessage},
          ${JSON.stringify(errorDetails)},
          ${JSON.stringify(suggestions)}
        )
        RETURNING *
      ` as Record<string, unknown>[];

      const diag = this.rowToDiagnostic(rows[0]!);
      log.info('Sync diagnostic recorded', { connectorInstanceId, errorCategory: category, syncJobId });
      return ok(diag);
    } catch (e) {
      log.error('Failed to record sync diagnostic', { connectorInstanceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve the last N diagnostics for a connector instance.
   *
   * @param connectorInstanceId - Connector to query
   * @param limit - Max diagnostics to return (default 10)
   */
  async getDiagnostics(
    connectorInstanceId: string,
    limit = 10,
  ): Promise<Result<SyncDiagnostic[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM sync_diagnostics
        WHERE connector_instance_id = ${connectorInstanceId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];

      return ok(rows.map((r) => this.rowToDiagnostic(r)));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Analyze recent sync failures to detect patterns in connector health.
   *
   * @param connectorInstanceId - Connector to analyze
   * @param lastN - Number of recent syncs to consider (default 10)
   */
  async analyzeConnectorHealth(
    connectorInstanceId: string,
    lastN = 10,
  ): Promise<ConnectorHealthPattern> {
    let diagnostics: SyncDiagnostic[] = [];
    try {
      const result = await this.getDiagnostics(connectorInstanceId, lastN);
      diagnostics = result.unwrapOr([]);
    } catch {
      // Ignore db errors and return healthy as default
    }

    if (diagnostics.length === 0) {
      return {
        connectorInstanceId,
        errorRate: 0,
        dominantCategory: null,
        patterns: [],
        healthStatus: 'healthy',
      };
    }

    const errorRate = diagnostics.filter((d) => !d.isResolved).length / diagnostics.length;

    // Find dominant error category
    const categoryCounts = new Map<ErrorCategory, number>();
    for (const d of diagnostics) {
      categoryCounts.set(d.errorCategory, (categoryCounts.get(d.errorCategory) ?? 0) + 1);
    }
    let dominantCategory: ErrorCategory | null = null;
    let maxCount = 0;
    for (const [cat, count] of categoryCounts) {
      if (count > maxCount) { maxCount = count; dominantCategory = cat; }
    }

    const patterns: string[] = [];
    if (errorRate > 0.8) patterns.push('Frequent failures (>80% error rate)');
    if (dominantCategory === 'auth_failure') patterns.push('Repeated auth failures — likely token expiry');
    if (dominantCategory === 'rate_limit') patterns.push('Consistent rate limiting — reduce sync frequency');

    const healthStatus = errorRate > 0.5 ? 'failing' : errorRate > 0.2 ? 'degraded' : 'healthy';

    return { connectorInstanceId, errorRate, dominantCategory, patterns, healthStatus };
  }

  /**
   * Mark a diagnostic as resolved.
   *
   * @param diagnosticId - UUID of the diagnostic entry
   */
  async resolve(diagnosticId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE sync_diagnostics
        SET is_resolved = TRUE, resolved_at = now()
        WHERE id = ${diagnosticId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private rowToDiagnostic(row: Record<string, unknown>): SyncDiagnostic {
    return {
      id: row['id'] as string,
      syncJobId: row['sync_job_id'] as string,
      connectorInstanceId: row['connector_instance_id'] as string,
      workspaceId: row['workspace_id'] as string,
      errorCategory: row['error_category'] as ErrorCategory,
      errorMessage: row['error_message'] as string,
      errorDetails: (row['error_details'] as Record<string, unknown>) ?? {},
      recoverySuggestions: (row['recovery_suggestions'] as RecoverySuggestion[]) ?? [],
      isResolved: row['is_resolved'] as boolean,
      resolvedAt: row['resolved_at'] ? new Date(row['resolved_at'] as string) : null,
      createdAt: new Date(row['created_at'] as string),
    };
  }
}
