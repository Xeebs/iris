import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHash } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'pii-masking-audit' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type MaskStrategy = 'redact' | 'hash' | 'tokenize' | 'keep_last_4' | 'none';

export type PiiAccessEvent = {
  id: string;
  workspaceId: string;
  actorId: string;
  actorType: 'user' | 'agent' | 'connector';
  fieldName: string;
  connectorId: string;
  accessType: 'read' | 'export' | 'embed';
  masked: boolean;
  strategy: MaskStrategy;
  accessedAt: Date;
};

export type FieldMaskRule = {
  workspaceId: string;
  connectorId: string;
  fieldName: string;
  strategy: MaskStrategy;
  updatedAt: Date;
};

export type BulkMaskRule = {
  fieldPattern: string;
  strategy: MaskStrategy;
  applyToAllConnectors: boolean;
};

export type AuditPage = {
  events: PiiAccessEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a cursor token from a timestamp and ID for pagination.
 */
export function encodeCursor(accessedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: accessedAt.toISOString(), id })).toString('base64url');
}

/**
 * Decode a cursor back to timestamp + id.
 */
export function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as { t: string; id: string };
  } catch {
    return null;
  }
}

/**
 * Apply a masking strategy to a single value for preview/test purposes.
 */
export function applyMaskPreview(value: string, strategy: MaskStrategy): string {
  switch (strategy) {
    case 'redact':
      return '[REDACTED]';
    case 'hash':
      return `[hash:${createHash('sha256').update(value).digest('hex').slice(0, 8)}]`;
    case 'tokenize':
      return `[token:${createHash('md5').update(value).digest('hex').slice(0, 12)}]`;
    case 'keep_last_4':
      return value.length > 4 ? `****${value.slice(-4)}` : '****';
    case 'none':
      return value;
  }
}

// ─── PiiMaskingAuditService ───────────────────────────────────────────────────

export class PiiMaskingAuditService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Log a PII field access event.
   */
  async logAccess(
    event: Omit<PiiAccessEvent, 'id' | 'accessedAt'>,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO pii_access_audit
          (workspace_id, actor_id, actor_type, field_name, connector_id, access_type, masked, strategy)
        VALUES (
          ${event.workspaceId},
          ${event.actorId},
          ${event.actorType},
          ${event.fieldName},
          ${event.connectorId},
          ${event.accessType},
          ${event.masked},
          ${event.strategy}
        )
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to log PII access', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a page of PII access events (cursor-paginated).
   *
   * @param workspaceId - Workspace filter
   * @param limit       - Page size (max 200)
   * @param cursor      - Opaque cursor from previous page
   */
  async listAccessEvents(
    workspaceId: string,
    limit = 50,
    cursor?: string,
  ): Promise<Result<AuditPage, Error>> {
    const safeLimit = Math.min(Math.max(1, limit), 200);

    try {
      type Row = {
        id: string;
        workspace_id: string;
        actor_id: string;
        actor_type: 'user' | 'agent' | 'connector';
        field_name: string;
        connector_id: string;
        access_type: 'read' | 'export' | 'embed';
        masked: boolean;
        strategy: MaskStrategy;
        accessed_at: Date;
      };

      let rows: Row[];

      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (!decoded) return err(new Error('Invalid cursor'));
        rows = await this.sql<Row[]>`
          SELECT id, workspace_id, actor_id, actor_type, field_name, connector_id,
                 access_type, masked, strategy, accessed_at
          FROM pii_access_audit
          WHERE workspace_id = ${workspaceId}
            AND (accessed_at, id) < (${decoded.t}::timestamptz, ${decoded.id})
          ORDER BY accessed_at DESC, id DESC
          LIMIT ${safeLimit + 1}
        `;
      } else {
        rows = await this.sql<Row[]>`
          SELECT id, workspace_id, actor_id, actor_type, field_name, connector_id,
                 access_type, masked, strategy, accessed_at
          FROM pii_access_audit
          WHERE workspace_id = ${workspaceId}
          ORDER BY accessed_at DESC, id DESC
          LIMIT ${safeLimit + 1}
        `;
      }

      const hasMore = rows.length > safeLimit;
      const page = rows.slice(0, safeLimit);
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.accessed_at, last.id) : null;

      const events: PiiAccessEvent[] = page.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        actorId: r.actor_id,
        actorType: r.actor_type,
        fieldName: r.field_name,
        connectorId: r.connector_id,
        accessType: r.access_type,
        masked: r.masked,
        strategy: r.strategy,
        accessedAt: r.accessed_at,
      }));

      return ok({ events, nextCursor, hasMore });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the mask rule for a specific field (returns null if none set).
   */
  async getFieldRule(
    workspaceId: string,
    connectorId: string,
    fieldName: string,
  ): Promise<Result<FieldMaskRule | null, Error>> {
    try {
      type Row = { connector_id: string; field_name: string; strategy: MaskStrategy; updated_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT connector_id, field_name, strategy, updated_at
        FROM pii_field_mask_rules
        WHERE workspace_id = ${workspaceId}
          AND connector_id = ${connectorId}
          AND field_name = ${fieldName}
        LIMIT 1
      `;
      if (rows.length === 0) return ok(null);
      const r = rows[0]!;
      return ok({ workspaceId, connectorId: r.connector_id, fieldName: r.field_name, strategy: r.strategy, updatedAt: r.updated_at });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Upsert a field-level mask strategy.
   */
  async setFieldStrategy(
    workspaceId: string,
    connectorId: string,
    fieldName: string,
    strategy: MaskStrategy,
  ): Promise<Result<FieldMaskRule, Error>> {
    try {
      type Row = { connector_id: string; field_name: string; strategy: MaskStrategy; updated_at: Date };
      const [row] = await this.sql<Row[]>`
        INSERT INTO pii_field_mask_rules
          (workspace_id, connector_id, field_name, strategy)
        VALUES (${workspaceId}, ${connectorId}, ${fieldName}, ${strategy})
        ON CONFLICT (workspace_id, connector_id, field_name) DO UPDATE SET
          strategy = EXCLUDED.strategy, updated_at = NOW()
        RETURNING connector_id, field_name, strategy, updated_at
      `;
      if (!row) return err(new Error('Upsert returned no row'));
      return ok({ workspaceId, connectorId: row.connector_id, fieldName: row.field_name, strategy: row.strategy, updatedAt: row.updated_at });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all field mask rules for a workspace.
   */
  async listFieldRules(workspaceId: string): Promise<Result<FieldMaskRule[], Error>> {
    try {
      type Row = { connector_id: string; field_name: string; strategy: MaskStrategy; updated_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT connector_id, field_name, strategy, updated_at
        FROM pii_field_mask_rules
        WHERE workspace_id = ${workspaceId}
        ORDER BY connector_id, field_name
      `;
      return ok(rows.map((r) => ({
        workspaceId,
        connectorId: r.connector_id,
        fieldName: r.field_name,
        strategy: r.strategy,
        updatedAt: r.updated_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Apply a bulk rule pattern (e.g., "*email*" → hash) across connectors.
   * Returns the number of rules created/updated.
   */
  async applyBulkRule(
    workspaceId: string,
    connectorIds: string[],
    rule: BulkMaskRule,
  ): Promise<Result<number, Error>> {
    const patternRegex = new RegExp(rule.fieldPattern.replace(/\*/g, '.*'), 'i');

    try {
      // Discover all distinct field names for this workspace
      type FieldRow = { field_name: string; connector_id: string };
      const knownFields = await this.sql<FieldRow[]>`
        SELECT DISTINCT field_name, connector_id
        FROM pii_field_mask_rules
        WHERE workspace_id = ${workspaceId}
        UNION
        SELECT DISTINCT jsonb_object_keys(attributes) AS field_name, source_connector_id AS connector_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
        LIMIT 1000
      `;

      const targets = knownFields.filter(
        (f) =>
          patternRegex.test(f.field_name) &&
          (rule.applyToAllConnectors || connectorIds.includes(f.connector_id)),
      );

      let count = 0;
      for (const { field_name, connector_id } of targets) {
        const result = await this.setFieldStrategy(workspaceId, connector_id, field_name, rule.strategy);
        if (result.isOk()) count++;
      }
      return ok(count);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
