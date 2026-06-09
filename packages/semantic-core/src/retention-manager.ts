import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'retention-manager' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArchiveAction = 'soft_delete' | 'cold_storage' | 'purge';

export type RetentionCondition = {
  field: string;
  operator: 'in_top' | 'older_than' | 'not_accessed_since' | 'has_tag';
  value: string | number;
};

export type RetentionPolicy = {
  id: string;
  entityType: string;
  retentionDays: number;
  archiveAction: ArchiveAction;
  conditions: RetentionCondition[];
  description: string;
  active: boolean;
  createdAt: Date;
};

export type ArchivedEntity = {
  id: string;
  entityId: string;
  entityType: string;
  reason: string;
  archiveAction: ArchiveAction;
  archivedAt: Date;
  recoveryWindowDays: number;
  recoveryDeadline: Date;
  restorable: boolean;
};

export type ArchivalAuditEntry = {
  id: string;
  entityId: string;
  action: 'archived' | 'restored' | 'purged';
  reason: string;
  actor: string;
  occurredAt: Date;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the archival date for an entity given its creation date and retention policy.
 * @param createdAt - Entity creation date
 * @param retentionDays - Number of days to retain
 * @returns Date when the entity should be archived
 */
export function computeArchivalDate(createdAt: Date, retentionDays: number): Date {
  const d = new Date(createdAt);
  d.setDate(d.getDate() + retentionDays);
  return d;
}

/**
 * Check if an entity is within its recovery window.
 * @param archivedAt - When the entity was archived
 * @param recoveryWindowDays - Recovery window in days
 * @param now - Current time (injectable for testing)
 * @returns true if still within recovery window
 */
export function isWithinRecoveryWindow(
  archivedAt: Date,
  recoveryWindowDays: number,
  now = new Date(),
): boolean {
  const deadline = new Date(archivedAt);
  deadline.setDate(deadline.getDate() + recoveryWindowDays);
  return now <= deadline;
}

/**
 * Determine if an entity passes all retention conditions (should be kept).
 * @param conditions - Retention conditions that exempt an entity from archival
 * @param entityAttributes - Entity attribute map
 * @returns true if entity should be KEPT (not archived)
 */
export function shouldKeepEntity(
  conditions: RetentionCondition[],
  entityAttributes: Record<string, unknown>,
): boolean {
  for (const cond of conditions) {
    if (cond.operator === 'has_tag') {
      const tags = entityAttributes['tags'];
      if (Array.isArray(tags) && tags.includes(String(cond.value))) return true;
    }
    if (cond.operator === 'not_accessed_since') {
      const lastAccess = entityAttributes['last_accessed_at'];
      if (lastAccess) {
        const daysSince = (Date.now() - new Date(lastAccess as string).getTime()) / 86400000;
        if (daysSince < Number(cond.value)) return true;
      }
    }
  }
  return false;
}

/**
 * Compute days until recovery deadline.
 * @param archivedAt - Archive timestamp
 * @param recoveryWindowDays - Recovery window length
 * @param now - Current time
 * @returns Days remaining (negative means expired)
 */
export function daysUntilRecoveryDeadline(archivedAt: Date, recoveryWindowDays: number, now = new Date()): number {
  const deadline = new Date(archivedAt);
  deadline.setDate(deadline.getDate() + recoveryWindowDays);
  return (deadline.getTime() - now.getTime()) / 86400000;
}

// ─── RetentionPolicyService ───────────────────────────────────────────────────

export class RetentionPolicyService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Define a retention policy for an entity type.
   */
  async defineRetentionPolicy(
    entityType: string,
    retentionDays: number,
    archiveAction: ArchiveAction,
    conditions: RetentionCondition[] = [],
    description = '',
  ): Promise<Result<RetentionPolicy, Error>> {
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO retention_policies (id, entity_type, retention_days, archive_action, conditions, description, active)
        VALUES (${id}, ${entityType}, ${retentionDays}, ${archiveAction}, ${JSON.stringify(conditions)}, ${description}, true)
        ON CONFLICT (entity_type) DO UPDATE SET
          retention_days = EXCLUDED.retention_days,
          archive_action = EXCLUDED.archive_action,
          conditions = EXCLUDED.conditions,
          description = EXCLUDED.description,
          updated_at = NOW()
      `;
      log.info('Retention policy defined', { entityType, retentionDays, archiveAction });
      return ok({ id, entityType, retentionDays, archiveAction, conditions, description, active: true, createdAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get all retention policies.
   */
  async listRetentionPolicies(): Promise<Result<RetentionPolicy[], Error>> {
    try {
      type Row = { id: string; entity_type: string; retention_days: number; archive_action: string; conditions: unknown; description: string; active: boolean; created_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_type, retention_days, archive_action, conditions, description, active, created_at
        FROM retention_policies ORDER BY entity_type
      `;
      return ok(rows.map((r) => ({
        id: r.id, entityType: r.entity_type, retentionDays: r.retention_days,
        archiveAction: r.archive_action as ArchiveAction,
        conditions: Array.isArray(r.conditions) ? (r.conditions as RetentionCondition[]) : JSON.parse(r.conditions as unknown as string),
        description: r.description, active: r.active, createdAt: r.created_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Archive an entity by moving it to cold storage.
   * @param entityId - Entity to archive
   * @param reason - Reason for archival
   * @param recoveryWindowDays - How long the entity can be restored (default: 30 days)
   */
  async archiveEntity(
    entityId: string,
    reason: string,
    recoveryWindowDays = 30,
  ): Promise<Result<ArchivedEntity, Error>> {
    const id = randomUUID();
    const archivedAt = new Date();
    const recoveryDeadline = new Date(archivedAt);
    recoveryDeadline.setDate(recoveryDeadline.getDate() + recoveryWindowDays);
    try {
      type EntityRow = { type: string };
      const [entity] = await this.sql<EntityRow[]>`SELECT type FROM iris_entities WHERE id = ${entityId}`;
      const entityType = entity?.type ?? 'unknown';
      await this.sql`
        INSERT INTO archived_entities (id, entity_id, entity_type, reason, archive_action, archived_at, recovery_window_days, recovery_deadline)
        VALUES (${id}, ${entityId}, ${entityType}, ${reason}, 'cold_storage', ${archivedAt}, ${recoveryWindowDays}, ${recoveryDeadline})
      `;
      await this.sql`
        INSERT INTO archival_audit (id, entity_id, action, reason, actor, occurred_at)
        VALUES (${randomUUID()}, ${entityId}, 'archived', ${reason}, 'system', NOW())
      `;
      log.info('Entity archived', { entityId, reason, recoveryWindowDays });
      return ok({ id, entityId, entityType, reason, archiveAction: 'cold_storage', archivedAt, recoveryWindowDays, recoveryDeadline, restorable: true });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Restore an archived entity if within recovery window.
   * @param entityId - Entity to restore
   */
  async restoreArchivedEntity(entityId: string): Promise<Result<void, Error>> {
    try {
      type Row = { archived_at: Date; recovery_window_days: number };
      const [record] = await this.sql<Row[]>`
        SELECT archived_at, recovery_window_days FROM archived_entities
        WHERE entity_id = ${entityId} ORDER BY archived_at DESC LIMIT 1
      `;
      if (!record) return err(new Error(`No archive record found for entity ${entityId}`));
      if (!isWithinRecoveryWindow(record.archived_at, record.recovery_window_days)) {
        return err(new Error(`Recovery window has expired for entity ${entityId}`));
      }
      await this.sql`DELETE FROM archived_entities WHERE entity_id = ${entityId}`;
      await this.sql`
        INSERT INTO archival_audit (id, entity_id, action, reason, actor, occurred_at)
        VALUES (${randomUUID()}, ${entityId}, 'restored', 'manual restore', 'system', NOW())
      `;
      log.info('Entity restored', { entityId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Query archived entities with optional filters.
   */
  async queryArchivedEntities(filters: {
    entityType?: string;
    sinceDate?: Date;
    reason?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Result<{ entities: ArchivedEntity[]; nextCursor: string | null }, Error>> {
    const limit = Math.min(filters.limit ?? 50, 200);
    try {
      type Row = { id: string; entity_id: string; entity_type: string; reason: string; archive_action: string; archived_at: Date; recovery_window_days: number; recovery_deadline: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_id, entity_type, reason, archive_action, archived_at, recovery_window_days, recovery_deadline
        FROM archived_entities
        WHERE (${filters.entityType ? this.sql`entity_type = ${filters.entityType}` : this.sql`TRUE`})
          AND (${filters.sinceDate ? this.sql`archived_at >= ${filters.sinceDate}` : this.sql`TRUE`})
          AND (${filters.reason ? this.sql`reason ILIKE ${'%' + filters.reason + '%'}` : this.sql`TRUE`})
          AND (${filters.cursor ? this.sql`id > ${filters.cursor}` : this.sql`TRUE`})
        ORDER BY archived_at DESC, id
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const slice = rows.slice(0, limit);
      const now = new Date();
      return ok({
        entities: slice.map((r) => ({
          id: r.id, entityId: r.entity_id, entityType: r.entity_type, reason: r.reason,
          archiveAction: r.archive_action as ArchiveAction,
          archivedAt: r.archived_at, recoveryWindowDays: r.recovery_window_days,
          recoveryDeadline: r.recovery_deadline,
          restorable: now <= r.recovery_deadline,
        })),
        nextCursor: hasMore ? (slice[slice.length - 1]?.id ?? null) : null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Run a batch archival job based on active retention policies.
   * @returns Count of entities archived
   */
  async runArchivalJobScheduled(): Promise<Result<{ archived: number }, Error>> {
    try {
      type PolicyRow = { entity_type: string; retention_days: number };
      const policies = await this.sql<PolicyRow[]>`SELECT entity_type, retention_days FROM retention_policies WHERE active = true`;
      let archived = 0;
      for (const policy of policies) {
        type EntityRow = { id: string };
        const entities = await this.sql<EntityRow[]>`
          SELECT id FROM iris_entities
          WHERE type = ${policy.entity_type}
            AND created_at < NOW() - (${policy.retention_days} || ' days')::interval
            AND id NOT IN (SELECT entity_id FROM archived_entities)
          LIMIT 100
        `;
        for (const entity of entities) {
          const result = await this.archiveEntity(entity.id, 'scheduled_retention_policy');
          if (result.isOk()) archived++;
        }
      }
      log.info('Archival job complete', { archived });
      return ok({ archived });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
