import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'entity-lifecycle' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'ARCHIVED';

export type LifecycleEvent = {
  id: string;
  entityId: string;
  fromStatus: EntityStatus | null;
  toStatus: EntityStatus;
  reason: string;
  actor: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
};

export type EntityApproval = {
  id: string;
  entityId: string;
  approverId: string;
  conditions: string | null;
  approvedAt: Date;
};

export type EntityLifecycleState = {
  entityId: string;
  currentStatus: EntityStatus;
  approvalCount: number;
  lastTransitionAt: Date;
  sunsetDate: Date | null;
  replacementEntityId: string | null;
};

export type EntityHealthScore = {
  entityId: string;
  score: number; // 0–100
  recencyFactor: number;
  approvalFactor: number;
  statusFactor: number;
  breakdown: Record<string, number>;
};

export type LifecycleDashboard = {
  totalByStatus: Record<EntityStatus, number>;
  pendingApprovals: number;
  deprecatedCount: number;
  archivedCount: number;
  atRiskEntities: string[];
};

// ─── State machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<EntityStatus, EntityStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DEPRECATED', 'ARCHIVED'],
  DEPRECATED: ['ARCHIVED', 'PUBLISHED'],
  ARCHIVED: [],
};

/**
 * Check if a status transition is valid.
 * @param from - Current status
 * @param to - Target status
 */
export function isValidTransition(from: EntityStatus, to: EntityStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Compute an entity health score from 0–100.
 * - Recency: entities not updated in >90 days lose points
 * - Approval: published entities without approvals lose points
 * - Status: DEPRECATED=-20, ARCHIVED=-40, PUBLISHED=+20
 * @param lastUpdatedDaysAgo - Days since last update
 * @param approvalCount - Number of explicit approvals
 * @param status - Current lifecycle status
 */
export function computeHealthScore(
  lastUpdatedDaysAgo: number,
  approvalCount: number,
  status: EntityStatus,
): EntityHealthScore & { entityId: string } {
  const recencyFactor = Math.max(0, 100 - lastUpdatedDaysAgo * 0.5);
  const approvalFactor = Math.min(approvalCount * 20, 40);
  const statusFactor: Record<EntityStatus, number> = {
    PUBLISHED: 20,
    DRAFT: 0,
    DEPRECATED: -20,
    ARCHIVED: -40,
  };
  const raw = recencyFactor * 0.4 + approvalFactor * 0.4 + statusFactor[status] + 40;
  const score = Math.max(0, Math.min(100, raw));
  return {
    entityId: '',
    score: Math.round(score),
    recencyFactor: Math.round(recencyFactor),
    approvalFactor,
    statusFactor: statusFactor[status]!,
    breakdown: {
      recency: Math.round(recencyFactor * 0.4),
      approval: Math.round(approvalFactor * 0.4),
      status: statusFactor[status]!,
    },
  };
}

/**
 * Determine if an entity is "at risk" (published but stale or unapproved).
 * @param status - Entity status
 * @param lastUpdatedDaysAgo - Days since last update
 * @param approvalCount - Number of approvals
 */
export function isAtRisk(status: EntityStatus, lastUpdatedDaysAgo: number, approvalCount: number): boolean {
  if (status !== 'PUBLISHED') return false;
  return lastUpdatedDaysAgo > 90 || approvalCount === 0;
}

// ─── EntityLifecycleManager ───────────────────────────────────────────────────

export class EntityLifecycleManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Define or transition the lifecycle status of an entity.
   */
  async defineEntityStatus(
    entityId: string,
    status: EntityStatus,
    reason: string,
    actor: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Result<LifecycleEvent, Error>> {
    try {
      type StateRow = { current_status: string };
      const [existing] = await this.sql<StateRow[]>`
        SELECT current_status FROM entity_lifecycle_states WHERE entity_id = ${entityId}
      `;

      const fromStatus = existing ? (existing.current_status as EntityStatus) : null;

      if (fromStatus && !isValidTransition(fromStatus, status)) {
        return err(new Error(`Invalid transition: ${fromStatus} → ${status}`));
      }

      const id = randomUUID();

      await this.sql`
        INSERT INTO entity_lifecycle_states (entity_id, current_status, last_transition_at)
        VALUES (${entityId}, ${status}, NOW())
        ON CONFLICT (entity_id) DO UPDATE
          SET current_status = EXCLUDED.current_status,
              last_transition_at = NOW()
      `;

      await this.sql`
        INSERT INTO lifecycle_events (id, entity_id, from_status, to_status, reason, actor, metadata, occurred_at)
        VALUES (${id}, ${entityId}, ${fromStatus}, ${status}, ${reason}, ${actor}, ${JSON.stringify(metadata)}, NOW())
      `;

      log.info('Entity status transition', { entityId, fromStatus, toStatus: status, actor });
      return ok({ id, entityId, fromStatus, toStatus: status, reason, actor, metadata, occurredAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the full status history for an entity.
   */
  async trackStatusHistory(entityId: string, limit = 50): Promise<Result<LifecycleEvent[], Error>> {
    try {
      type Row = { id: string; entity_id: string; from_status: string | null; to_status: string; reason: string; actor: string; metadata: Record<string, unknown>; occurred_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_id, from_status, to_status, reason, actor, metadata, occurred_at
        FROM lifecycle_events WHERE entity_id = ${entityId}
        ORDER BY occurred_at DESC LIMIT ${limit}
      `;
      return ok(rows.map((r) => ({
        id: r.id,
        entityId: r.entity_id,
        fromStatus: r.from_status as EntityStatus | null,
        toStatus: r.to_status as EntityStatus,
        reason: r.reason,
        actor: r.actor,
        metadata: r.metadata ?? {},
        occurredAt: r.occurred_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record an explicit approval for an entity.
   */
  async approveEntity(
    entityId: string,
    approverId: string,
    conditions: string | null = null,
  ): Promise<Result<EntityApproval, Error>> {
    try {
      const id = randomUUID();
      await this.sql`
        INSERT INTO entity_approvals (id, entity_id, approver_id, conditions, approved_at)
        VALUES (${id}, ${entityId}, ${approverId}, ${conditions}, NOW())
        ON CONFLICT (entity_id, approver_id) DO UPDATE SET approved_at = NOW(), conditions = EXCLUDED.conditions
      `;
      log.info('Entity approved', { entityId, approverId });
      return ok({ id, entityId, approverId, conditions, approvedAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Deprecate an entity with a replacement and sunset date.
   */
  async deprecateEntity(
    entityId: string,
    actor: string,
    replacementEntityId: string | null = null,
    sunsetDate: Date | null = null,
  ): Promise<Result<LifecycleEvent, Error>> {
    try {
      if (replacementEntityId || sunsetDate) {
        await this.sql`
          UPDATE entity_lifecycle_states
          SET replacement_entity_id = ${replacementEntityId}, sunset_date = ${sunsetDate}
          WHERE entity_id = ${entityId}
        `;
      }
      return this.defineEntityStatus(entityId, 'DEPRECATED', 'Entity deprecated', actor, {
        replacementEntityId,
        sunsetDate: sunsetDate?.toISOString() ?? null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Query entities by lifecycle status with optional stale/at-risk flags.
   */
  async queryEntitiesByLifecycle(filters: {
    status?: EntityStatus;
    atRiskOnly?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<Result<{ states: EntityLifecycleState[]; nextCursor: string | null }, Error>> {
    const limit = Math.min(filters.limit ?? 50, 200);
    try {
      type Row = { entity_id: string; current_status: string; approval_count: number; last_transition_at: Date; sunset_date: Date | null; replacement_entity_id: string | null };
      const rows = await this.sql<Row[]>`
        SELECT s.entity_id, s.current_status, s.sunset_date, s.replacement_entity_id, s.last_transition_at,
               COUNT(a.id)::int AS approval_count
        FROM entity_lifecycle_states s
        LEFT JOIN entity_approvals a ON a.entity_id = s.entity_id
        WHERE (${filters.status ? this.sql`s.current_status = ${filters.status}` : this.sql`TRUE`})
          AND (${filters.cursor ? this.sql`s.entity_id > ${filters.cursor}` : this.sql`TRUE`})
        GROUP BY s.entity_id, s.current_status, s.sunset_date, s.replacement_entity_id, s.last_transition_at
        ORDER BY s.entity_id
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const slice = rows.slice(0, limit);
      const nextCursor = hasMore ? (slice[slice.length - 1]?.entity_id ?? null) : null;

      return ok({
        states: slice.map((r) => ({
          entityId: r.entity_id,
          currentStatus: r.current_status as EntityStatus,
          approvalCount: r.approval_count,
          lastTransitionAt: r.last_transition_at,
          sunsetDate: r.sunset_date,
          replacementEntityId: r.replacement_entity_id,
        })),
        nextCursor,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute entity health score from DB data.
   */
  async computeEntityHealthScore(entityId: string): Promise<Result<EntityHealthScore, Error>> {
    try {
      type Row = { current_status: string; last_transition_at: Date; approval_count: number };
      const [row] = await this.sql<Row[]>`
        SELECT s.current_status, s.last_transition_at, COUNT(a.id)::int AS approval_count
        FROM entity_lifecycle_states s
        LEFT JOIN entity_approvals a ON a.entity_id = s.entity_id
        WHERE s.entity_id = ${entityId}
        GROUP BY s.current_status, s.last_transition_at
      `;
      if (!row) return err(new Error(`Entity ${entityId} not found in lifecycle states`));
      const daysAgo = Math.floor((Date.now() - row.last_transition_at.getTime()) / 86_400_000);
      const result = computeHealthScore(daysAgo, row.approval_count, row.current_status as EntityStatus);
      result.entityId = entityId;
      return ok(result);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the lifecycle dashboard summary.
   */
  async getLifecycleDashboard(): Promise<Result<LifecycleDashboard, Error>> {
    try {
      type StatusRow = { current_status: string; count: number };
      const statusRows = await this.sql<StatusRow[]>`
        SELECT current_status, COUNT(*)::int AS count FROM entity_lifecycle_states GROUP BY current_status
      `;
      const totalByStatus: Record<EntityStatus, number> = { DRAFT: 0, PUBLISHED: 0, DEPRECATED: 0, ARCHIVED: 0 };
      for (const row of statusRows) {
        totalByStatus[row.current_status as EntityStatus] = row.count;
      }

      type ApprovalRow = { entity_id: string };
      const pendingRows = await this.sql<ApprovalRow[]>`
        SELECT s.entity_id FROM entity_lifecycle_states s
        WHERE s.current_status = 'PUBLISHED'
          AND NOT EXISTS (SELECT 1 FROM entity_approvals a WHERE a.entity_id = s.entity_id)
      `;

      return ok({
        totalByStatus,
        pendingApprovals: pendingRows.length,
        deprecatedCount: totalByStatus.DEPRECATED,
        archivedCount: totalByStatus.ARCHIVED,
        atRiskEntities: pendingRows.map((r) => r.entity_id).slice(0, 10),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
