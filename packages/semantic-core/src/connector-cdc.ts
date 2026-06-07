import { createHash } from 'crypto';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'connector-cdc' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CDCStrategy = 'cursor' | 'event_driven' | 'snapshot_diff';

export type ChangeDataCaptureConfig = {
  strategy: CDCStrategy;
  cursorField?: string;
};

export type CDCState = {
  connectorInstanceId: string;
  workspaceId: string;
  strategy: CDCStrategy;
  lastCursor: string | null;
  lastSnapshotHash: string | null;
  entitiesChanged: number;
  entitiesUnchanged: number;
  syncEfficiencyRatio: number | null;
  lastSyncAt: Date | null;
};

export type CDCRunResult = {
  strategy: CDCStrategy;
  entitiesChanged: number;
  entitiesUnchanged: number;
  syncEfficiencyRatio: number;
  newCursor: string | null;
};

export type EntityDelta = {
  entity: SemanticEntity;
  changeType: 'created' | 'updated' | 'unchanged';
};

// ─── ConnectorCDCManager ───────────────────────────────────────────────────────

/**
 * Manages Change Data Capture strategies for connector incremental syncs.
 * Reduces duplicate indexing by detecting which entities have actually changed.
 */
export class ConnectorCDCManager {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Detect which entities have changed since the last sync by hashing entity state.
   * Returns deltas classified as created, updated, or unchanged.
   *
   * @param connectorInstanceId - The connector instance being synced
   * @param entities - All entities fetched from the connector
   * @param config - CDC configuration from the connector manifest
   * @returns Array of entity deltas with change types
   */
  async computeDeltas(
    connectorInstanceId: string,
    entities: SemanticEntity[],
    config: ChangeDataCaptureConfig,
  ): Promise<Result<EntityDelta[], Error>> {
    try {
      if (config.strategy === 'cursor') {
        // For cursor-based: all entities are "changed" relative to last cursor
        return ok(entities.map((entity) => ({ entity, changeType: 'updated' as const })));
      }

      if (config.strategy === 'snapshot_diff') {
        return await this.computeSnapshotDeltas(connectorInstanceId, entities);
      }

      // event_driven: entities passed in are already the changed set
      return ok(entities.map((entity) => ({ entity, changeType: 'updated' as const })));
    } catch (e) {
      log.error('Failed to compute CDC deltas', { connectorInstanceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Updates CDC state after a sync run completes.
   *
   * @param connectorInstanceId - The connector instance that completed sync
   * @param workspaceId - Tenant workspace
   * @param result - Metrics from the CDC run
   * @param config - CDC strategy config
   */
  async updateState(
    connectorInstanceId: string,
    workspaceId: string,
    result: CDCRunResult,
    config: ChangeDataCaptureConfig,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO connector_cdc_state (
          connector_instance_id, workspace_id, strategy,
          last_cursor, entities_changed, entities_unchanged,
          sync_efficiency_ratio, last_sync_at
        ) VALUES (
          ${connectorInstanceId}, ${workspaceId}, ${config.strategy},
          ${result.newCursor},
          ${result.entitiesChanged},
          ${result.entitiesUnchanged},
          ${result.syncEfficiencyRatio},
          now()
        )
        ON CONFLICT (connector_instance_id) DO UPDATE SET
          strategy = EXCLUDED.strategy,
          last_cursor = EXCLUDED.last_cursor,
          entities_changed = EXCLUDED.entities_changed,
          entities_unchanged = EXCLUDED.entities_unchanged,
          sync_efficiency_ratio = EXCLUDED.sync_efficiency_ratio,
          last_sync_at = EXCLUDED.last_sync_at,
          updated_at = now()
      `;
      log.info('CDC state updated', {
        connectorInstanceId,
        strategy: config.strategy,
        entitiesChanged: result.entitiesChanged,
        entitiesUnchanged: result.entitiesUnchanged,
        syncEfficiencyRatio: result.syncEfficiencyRatio,
      });
      return ok(undefined);
    } catch (e) {
      log.error('Failed to update CDC state', { connectorInstanceId, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns the current CDC state for a connector instance.
   *
   * @param connectorInstanceId - The connector instance to look up
   */
  async getState(connectorInstanceId: string): Promise<Result<CDCState | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM connector_cdc_state
        WHERE connector_instance_id = ${connectorInstanceId}
      ` as Record<string, unknown>[];

      if (rows.length === 0) return ok(null);
      const r = rows[0]!;
      const state: CDCState = {
        connectorInstanceId: r['connector_instance_id'] as string,
        workspaceId: r['workspace_id'] as string,
        strategy: r['strategy'] as CDCStrategy,
        lastCursor: r['last_cursor'] as string | null,
        lastSnapshotHash: r['last_snapshot_hash'] as string | null,
        entitiesChanged: r['entities_changed'] as number,
        entitiesUnchanged: r['entities_unchanged'] as number,
        syncEfficiencyRatio: r['sync_efficiency_ratio'] as number | null,
        lastSyncAt: r['last_sync_at'] ? new Date(r['last_sync_at'] as string) : null,
      };
      return ok(state);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Selects the optimal CDC strategy for a connector based on its capabilities.
   * Prefers event_driven > cursor > snapshot_diff.
   *
   * @param supportedStrategies - Strategies declared by the connector manifest
   */
  selectStrategy(supportedStrategies: CDCStrategy[]): CDCStrategy {
    if (supportedStrategies.includes('event_driven')) return 'event_driven';
    if (supportedStrategies.includes('cursor')) return 'cursor';
    return 'snapshot_diff';
  }

  /**
   * Builds the CDC run result summary from entity deltas.
   *
   * @param deltas - Classified entity changes
   * @param newCursor - New cursor value after the sync (for cursor strategy)
   */
  buildRunResult(deltas: EntityDelta[], newCursor: string | null = null): CDCRunResult {
    const changed = deltas.filter((d) => d.changeType !== 'unchanged').length;
    const unchanged = deltas.filter((d) => d.changeType === 'unchanged').length;
    const total = deltas.length;
    const syncEfficiencyRatio = total > 0 ? unchanged / total : 1;

    return {
      strategy: 'cursor',
      entitiesChanged: changed,
      entitiesUnchanged: unchanged,
      syncEfficiencyRatio,
      newCursor,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async computeSnapshotDeltas(
    connectorInstanceId: string,
    entities: SemanticEntity[],
  ): Promise<Result<EntityDelta[], Error>> {
    // Build a hash for the current snapshot
    const currentHashes = new Map<string, string>();
    for (const entity of entities) {
      const hash = createHash('sha256')
        .update(JSON.stringify({ attrs: entity.attributes, label: entity.label }))
        .digest('hex')
        .slice(0, 12);
      currentHashes.set(entity.id, hash);
    }

    // Fetch stored hashes from last snapshot
    let previousHashes = new Map<string, string>();
    try {
      const rows = await this.sql`
        SELECT entity_id, hash FROM connector_entity_hashes
        WHERE connector_instance_id = ${connectorInstanceId}
      ` as { entity_id: string; hash: string }[];
      previousHashes = new Map(rows.map((r) => [r.entity_id, r.hash]));
    } catch {
      // Table may not exist yet — treat all as created
    }

    const deltas: EntityDelta[] = entities.map((entity) => {
      const prev = previousHashes.get(entity.id);
      const curr = currentHashes.get(entity.id)!;
      if (!prev) return { entity, changeType: 'created' as const };
      if (prev !== curr) return { entity, changeType: 'updated' as const };
      return { entity, changeType: 'unchanged' as const };
    });

    // Persist new hashes (best-effort, don't fail the sync on error)
    try {
      for (const [entityId, hash] of currentHashes) {
        await this.sql`
          INSERT INTO connector_entity_hashes (connector_instance_id, entity_id, hash)
          VALUES (${connectorInstanceId}, ${entityId}, ${hash})
          ON CONFLICT (connector_instance_id, entity_id) DO UPDATE SET hash = EXCLUDED.hash
        `;
      }
    } catch {
      log.warn('Failed to persist entity hashes (non-fatal)', { connectorInstanceId });
    }

    return ok(deltas);
  }
}
