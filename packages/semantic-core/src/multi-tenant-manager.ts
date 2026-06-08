import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'multi-tenant-manager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostCategory = 'embeddings' | 'queries' | 'storage' | 'cache_miss';
export type QueryType = 'vector_search' | 'graph_expansion' | 'compression';

export interface WorkspaceCostEntry {
  workspaceId: string;
  date: string;
  costCategory: CostCategory;
  amountCents: number;
  metadata: Record<string, unknown>;
}

export interface WorkspaceCostSummary {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  byCategory: Record<CostCategory, number>;
  dailyTrend: Array<{ date: string; amountCents: number }>;
}

export interface WorkspaceIsolationError extends Error {
  kind: 'workspace_mismatch' | 'missing_workspace' | 'entity_not_found';
}

export interface CostStore {
  recordCost(entry: WorkspaceCostEntry): Promise<void>;
  getCosts(workspaceId: string, from: Date, to: Date): Promise<WorkspaceCostEntry[]>;
  getEntityWorkspace(entityId: string): Promise<string | null>;
}

// Cost constants
const EMBEDDING_COST_PER_1M_TOKENS_CENTS = 2; // $0.02 / 1M tokens
const MCP_QUERY_COST_CENTS = 0.1; // $0.001 per query
const CACHE_MISS_OVERHEAD_CENTS = 0.05;

// ---------------------------------------------------------------------------
// Isolation helpers (pure functions, usable in middleware)
// ---------------------------------------------------------------------------

/**
 * Validate that the workspace in the request header matches a claim from JWT.
 * Returns err if headers are absent or if workspaceId from header ≠ jwt claim.
 *
 * @param requestWorkspaceId - Workspace from x-workspace-id header
 * @param jwtWorkspaceId - Workspace claim from JWT (may be undefined for API keys)
 */
export function validateWorkspaceClaim(
  requestWorkspaceId: string | undefined,
  jwtWorkspaceId: string | undefined,
): Result<string, WorkspaceIsolationError> {
  if (!requestWorkspaceId) {
    return err(
      Object.assign(new Error('Missing workspace ID'), { kind: 'missing_workspace' as const }),
    );
  }

  if (jwtWorkspaceId && jwtWorkspaceId !== requestWorkspaceId) {
    log.warn('Workspace claim mismatch', { requestWorkspaceId, jwtWorkspaceId });
    return err(
      Object.assign(new Error('Workspace ID does not match JWT claim'), {
        kind: 'workspace_mismatch' as const,
      }),
    );
  }

  return ok(requestWorkspaceId);
}

/**
 * Validate that all entity IDs in a result set belong to the workspace.
 * Used as a safety net after DB queries to prevent cross-tenant data leakage.
 *
 * @param workspaceId - Expected workspace
 * @param entities - Array of objects with a workspaceId field
 * @returns err with the first violating entity ID, or ok if all are valid
 */
export function validateWorkspaceBoundaries<T extends { workspaceId?: string }>(
  workspaceId: string,
  entities: T[],
): Result<T[], WorkspaceIsolationError> {
  for (const entity of entities) {
    if (entity.workspaceId && entity.workspaceId !== workspaceId) {
      log.error('Workspace boundary violation detected', {
        expectedWorkspace: workspaceId,
        entityWorkspace: entity.workspaceId,
      });
      return err(
        Object.assign(new Error(`Entity workspace ${entity.workspaceId} ≠ ${workspaceId}`), {
          kind: 'workspace_mismatch' as const,
        }),
      );
    }
  }
  return ok(entities);
}

// ---------------------------------------------------------------------------
// MultiTenantManager
// ---------------------------------------------------------------------------

/**
 * Manages workspace cost attribution and isolation enforcement.
 * Pure cost computation is stateless; store-dependent methods use the injected CostStore.
 */
export class MultiTenantManager {
  constructor(private readonly store: CostStore) {}

  /**
   * Record the cost of embedding a batch of tokens for a workspace.
   *
   * @param workspaceId - Workspace incurring the cost
   * @param tokenCount - Number of tokens embedded
   * @param metadata - Optional metadata (connector, entity type, etc.)
   */
  async recordEmbeddingCost(
    workspaceId: string,
    tokenCount: number,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const amountCents = computeEmbeddingCost(tokenCount);
    await this.store.recordCost({
      workspaceId,
      date: todayISO(),
      costCategory: 'embeddings',
      amountCents,
      metadata: { tokenCount, ...metadata },
    });
    log.debug('Embedding cost recorded', { workspaceId, tokenCount, amountCents });
  }

  /**
   * Record the cost of an MCP query execution.
   *
   * @param workspaceId - Workspace running the query
   * @param cacheHit - If true, no query cost is incurred (cache saved the cost)
   * @param metadata - Optional metadata
   */
  async recordQueryCost(
    workspaceId: string,
    cacheHit: boolean,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (cacheHit) return;

    await this.store.recordCost({
      workspaceId,
      date: todayISO(),
      costCategory: 'queries',
      amountCents: MCP_QUERY_COST_CENTS,
      metadata,
    });
  }

  /**
   * Record a cache miss penalty (extra cost incurred because cache wasn't warm).
   *
   * @param workspaceId - Workspace incurring the cost
   */
  async recordCacheMiss(workspaceId: string): Promise<void> {
    await this.store.recordCost({
      workspaceId,
      date: todayISO(),
      costCategory: 'cache_miss',
      amountCents: CACHE_MISS_OVERHEAD_CENTS,
      metadata: {},
    });
  }

  /**
   * Aggregate workspace costs for a period and return a structured summary.
   *
   * @param workspaceId - Workspace to analyse
   * @param periodStart - Start of period (inclusive)
   * @param periodEnd - End of period (inclusive)
   */
  async computeWorkspaceCosts(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<WorkspaceCostSummary> {
    const entries = await this.store.getCosts(workspaceId, periodStart, periodEnd);

    const byCategory: Record<CostCategory, number> = {
      embeddings: 0,
      queries: 0,
      storage: 0,
      cache_miss: 0,
    };
    const dailyMap = new Map<string, number>();

    for (const entry of entries) {
      byCategory[entry.costCategory] = (byCategory[entry.costCategory] ?? 0) + entry.amountCents;
      dailyMap.set(entry.date, (dailyMap.get(entry.date) ?? 0) + entry.amountCents);
    }

    const totalCents = Object.values(byCategory).reduce((a, b) => a + b, 0);

    const dailyTrend = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amountCents]) => ({ date, amountCents }));

    return { workspaceId, periodStart, periodEnd, totalCents, byCategory, dailyTrend };
  }

  /**
   * Validate that an entity belongs to the given workspace.
   * Uses the store to check entity workspace ownership.
   *
   * @param workspaceId - Expected workspace
   * @param entityId - Entity to check
   */
  async validateEntityOwnership(
    workspaceId: string,
    entityId: string,
  ): Promise<Result<void, WorkspaceIsolationError>> {
    const entityWorkspace = await this.store.getEntityWorkspace(entityId);

    if (!entityWorkspace) {
      return err(
        Object.assign(new Error(`Entity ${entityId} not found`), {
          kind: 'entity_not_found' as const,
        }),
      );
    }

    if (entityWorkspace !== workspaceId) {
      log.warn('Entity ownership violation', { workspaceId, entityId, entityWorkspace });
      return err(
        Object.assign(
          new Error(`Entity ${entityId} belongs to workspace ${entityWorkspace}, not ${workspaceId}`),
          { kind: 'workspace_mismatch' as const },
        ),
      );
    }

    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// Pure cost computation helpers (exported for use elsewhere)
// ---------------------------------------------------------------------------

/**
 * Compute the cost in fractional cents for embedding a given token count.
 *
 * @param tokenCount - Number of tokens to embed
 */
export function computeEmbeddingCost(tokenCount: number): number {
  return (tokenCount / 1_000_000) * EMBEDDING_COST_PER_1M_TOKENS_CENTS;
}

/**
 * Format a cost in cents as a USD dollar string.
 *
 * @param amountCents - Amount in fractional cents
 */
export function formatCostUSD(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(4)}`;
}

/**
 * Estimate monthly projection from a period's cost data.
 *
 * @param totalCents - Total cost over the period
 * @param periodDays - Number of days in the period
 */
export function projectMonthlyCost(totalCents: number, periodDays: number): number {
  if (periodDays === 0) return 0;
  return (totalCents / periodDays) * 30;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
