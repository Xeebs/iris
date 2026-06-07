import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'dsr-handler' });

/** Erasure is delayed 24h so admins can cancel before irreversible deletion. */
const ERASURE_CONFIRMATION_DELAY_MS = 24 * 60 * 60 * 1000;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdentifierType = 'email' | 'user_id' | 'pii';
export type RequestType = 'access' | 'erasure';
export type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type DSRRequest = {
  id: string;
  workspaceId: string;
  subjectIdentifier: string;
  identifierType: IdentifierType;
  requestType: RequestType;
  status: RequestStatus;
  requestedBy: string | null;
  exportUrl: string | null;
  errorMessage: string | null;
  executeAfter: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type SubjectData = {
  requestId: string;
  subjectIdentifier: string;
  workspaceId: string;
  entities: {
    id: string;
    type: string;
    label: string;
    attributes: Record<string, unknown>;
    connectorInstanceId: string;
  }[];
  exportedAt: Date;
};

// ─── DataSubjectRequestHandler ────────────────────────────────────────────────

/**
 * GDPR Data Subject Request handler.
 * Supports "right to access" (export all data about a subject) and
 * "right to erasure" (scheduled deletion with audit trail and 24h delay).
 */
export class DataSubjectRequestHandler {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Create a new DSR. For erasure requests, sets execute_after to 24h from now.
   *
   * @param workspaceId - Tenant workspace
   * @param subjectIdentifier - The PII value identifying the subject (e.g. email)
   * @param identifierType - Type of identifier used
   * @param requestType - access or erasure
   * @param requestedBy - Actor initiating the request (user ID or email)
   */
  async create(
    workspaceId: string,
    subjectIdentifier: string,
    identifierType: IdentifierType,
    requestType: RequestType,
    requestedBy?: string,
  ): Promise<Result<DSRRequest, Error>> {
    try {
      const executeAfter = requestType === 'erasure'
        ? new Date(Date.now() + ERASURE_CONFIRMATION_DELAY_MS)
        : null;

      const rows = await this.sql`
        INSERT INTO dsr_requests (
          workspace_id, subject_identifier, identifier_type,
          request_type, status, requested_by, execute_after
        ) VALUES (
          ${workspaceId}, ${subjectIdentifier}, ${identifierType},
          ${requestType}, 'pending', ${requestedBy ?? null}, ${executeAfter}
        )
        RETURNING *
      ` as Record<string, unknown>[];

      const request = this.rowToRequest(rows[0]!);

      await this.auditLog(request.id, 'created', requestedBy, {
        requestType,
        identifierType,
        executeAfter,
      });

      log.info('DSR created', { requestId: request.id, workspaceId, requestType });
      return ok(request);
    } catch (e) {
      log.error('Failed to create DSR', { workspaceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a DSR by ID, scoped to the workspace.
   *
   * @param requestId - UUID of the DSR
   * @param workspaceId - Tenant workspace for authorization
   */
  async getById(requestId: string, workspaceId: string): Promise<Result<DSRRequest | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM dsr_requests
        WHERE id = ${requestId} AND workspace_id = ${workspaceId}
      ` as Record<string, unknown>[];

      if (rows.length === 0) return ok(null);
      return ok(this.rowToRequest(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Execute an access request: find all entities linked to the subject and return
   * a portable JSON export.
   *
   * @param requestId - UUID of the DSR
   * @param workspaceId - Tenant workspace
   */
  async executeAccess(requestId: string, workspaceId: string): Promise<Result<SubjectData, Error>> {
    try {
      await this.sql`
        UPDATE dsr_requests SET status = 'processing', updated_at = now()
        WHERE id = ${requestId} AND workspace_id = ${workspaceId}
      `;

      // Find all entities that match the subject's identifier
      const requestRows = await this.sql`
        SELECT subject_identifier, identifier_type FROM dsr_requests
        WHERE id = ${requestId}
      ` as { subject_identifier: string; identifier_type: string }[];

      if (requestRows.length === 0) {
        return err(new Error('DSR not found'));
      }

      const { subject_identifier, identifier_type } = requestRows[0]!;

      const entityRows = await this.sql`
        SELECT id, type, label, attributes, connector_instance_id
        FROM semantic_entities
        WHERE workspace_id = ${workspaceId}
          AND (
            attributes->>${identifier_type} = ${subject_identifier}
            OR attributes->>'email' = ${subject_identifier}
          )
      ` as { id: string; type: string; label: string; attributes: Record<string, unknown>; connector_instance_id: string }[];

      const subjectData: SubjectData = {
        requestId,
        subjectIdentifier: subject_identifier,
        workspaceId,
        entities: entityRows.map((r) => ({
          id: r.id,
          type: r.type,
          label: r.label,
          attributes: r.attributes,
          connectorInstanceId: r.connector_instance_id,
        })),
        exportedAt: new Date(),
      };

      await this.sql`
        UPDATE dsr_requests SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = ${requestId}
      `;

      await this.auditLog(requestId, 'access_completed', null, {
        entityCount: subjectData.entities.length,
      });

      return ok(subjectData);
    } catch (e) {
      await this.sql`
        UPDATE dsr_requests SET status = 'failed', error_message = ${String(e)}, updated_at = now()
        WHERE id = ${requestId}
      `.catch(() => undefined);
      log.error('Access DSR execution failed', { requestId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Execute an erasure request. Only allowed after execute_after delay has passed.
   * Permanently deletes all PII-attributed entities for the subject.
   *
   * @param requestId - UUID of the DSR
   * @param workspaceId - Tenant workspace
   * @param executedBy - Actor confirming the deletion
   */
  async executeErasure(
    requestId: string,
    workspaceId: string,
    executedBy?: string,
  ): Promise<Result<{ deletedCount: number }, Error>> {
    try {
      const requestRows = await this.sql`
        SELECT subject_identifier, identifier_type, execute_after, status
        FROM dsr_requests
        WHERE id = ${requestId} AND workspace_id = ${workspaceId}
      ` as { subject_identifier: string; identifier_type: string; execute_after: string | null; status: string }[];

      if (requestRows.length === 0) {
        return err(new Error('DSR not found'));
      }

      const req = requestRows[0]!;

      if (req.status === 'completed') {
        return err(new Error('DSR has already been executed'));
      }
      if (req.status === 'cancelled') {
        return err(new Error('DSR has been cancelled'));
      }

      if (req.execute_after && new Date(req.execute_after) > new Date()) {
        return err(new Error('Erasure confirmation delay has not elapsed yet'));
      }

      await this.sql`
        UPDATE dsr_requests SET status = 'processing', updated_at = now()
        WHERE id = ${requestId}
      `;

      // Delete entities matching the subject identifier
      const deleteResult = await this.sql`
        DELETE FROM semantic_entities
        WHERE workspace_id = ${workspaceId}
          AND (
            attributes->>${req.identifier_type} = ${req.subject_identifier}
            OR attributes->>'email' = ${req.subject_identifier}
          )
        RETURNING id
      ` as { id: string }[];

      const deletedCount = deleteResult.length;

      await this.sql`
        UPDATE dsr_requests SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = ${requestId}
      `;

      await this.auditLog(requestId, 'erasure_completed', executedBy, { deletedCount });

      log.info('Erasure DSR completed', { requestId, workspaceId, deletedCount });
      return ok({ deletedCount });
    } catch (e) {
      await this.sql`
        UPDATE dsr_requests SET status = 'failed', error_message = ${String(e)}, updated_at = now()
        WHERE id = ${requestId}
      `.catch(() => undefined);
      log.error('Erasure DSR execution failed', { requestId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Cancel a pending erasure request before the delay elapses.
   *
   * @param requestId - UUID of the DSR
   * @param workspaceId - Tenant workspace
   * @param cancelledBy - Actor cancelling the request
   */
  async cancel(
    requestId: string,
    workspaceId: string,
    cancelledBy?: string,
  ): Promise<Result<void, Error>> {
    try {
      const rows = await this.sql`
        UPDATE dsr_requests SET status = 'cancelled', updated_at = now()
        WHERE id = ${requestId} AND workspace_id = ${workspaceId}
          AND status IN ('pending', 'processing')
        RETURNING id
      ` as { id: string }[];

      if (rows.length === 0) {
        return err(new Error('DSR not found or not cancellable'));
      }

      await this.auditLog(requestId, 'cancelled', cancelledBy, {});
      log.info('DSR cancelled', { requestId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async auditLog(
    requestId: string,
    action: string,
    actor: string | null | undefined,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.sql`
        INSERT INTO dsr_audit_log (dsr_request_id, action, actor, details)
        VALUES (${requestId}, ${action}, ${actor ?? null}, ${JSON.stringify(details)})
      `;
    } catch {
      log.warn('Failed to write DSR audit log (non-fatal)', { requestId, action });
    }
  }

  private rowToRequest(row: Record<string, unknown>): DSRRequest {
    return {
      id: row['id'] as string,
      workspaceId: row['workspace_id'] as string,
      subjectIdentifier: row['subject_identifier'] as string,
      identifierType: row['identifier_type'] as IdentifierType,
      requestType: row['request_type'] as RequestType,
      status: row['status'] as RequestStatus,
      requestedBy: row['requested_by'] as string | null,
      exportUrl: row['export_url'] as string | null,
      errorMessage: row['error_message'] as string | null,
      executeAfter: row['execute_after'] ? new Date(row['execute_after'] as string) : null,
      completedAt: row['completed_at'] ? new Date(row['completed_at'] as string) : null,
      createdAt: new Date(row['created_at'] as string),
    };
  }
}
