import { ok, err, type Result } from 'neverthrow';
import { createHash } from 'crypto';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'context-delta-streamer' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type ContextEntity = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  lastModified?: string | Date;
};

export type EntityDelta = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

export type ContextDelta = {
  added: ContextEntity[];
  removed: ContextEntity[];
  modified: Array<{ entity: ContextEntity; changes: EntityDelta[] }>;
  savedTokens: number;
  totalNewTokens: number;
};

export type ContextChunk = {
  chunkIndex: number;
  totalChunks: number;
  entities: ContextEntity[];
  estimatedTokens: number;
};

export type ClientContextState = {
  clientId: string;
  workspaceId: string;
  lastQueryHash: string;
  lastContextSnapshot: string;
  entitiesServed: string[];
  snapshotCreatedAt: Date;
  expiresAt: Date;
};

export type ContextDeltaAudit = {
  clientId: string;
  deltaId: string;
  entitiesAddedCount: number;
  entitiesRemovedCount: number;
  entitiesModifiedCount: number;
  savedTokens: number;
  streamChunks: number;
  deliveredAt: Date;
};

/** State TTL: 30 minutes of inactivity */
const CLIENT_STATE_TTL_MS = 30 * 60 * 1000;

/** Rough tokens-per-entity estimate for budget calculation. */
const TOKENS_PER_ENTITY = 50;

/**
 * Compute a SHA-256 hash of a context (list of entity IDs + modified timestamps).
 * @param entities - Entities to fingerprint
 */
export function hashContextSnapshot(entities: ContextEntity[]): string {
  const fingerprint = entities
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(e => `${e.id}:${String(e.lastModified ?? '')}`)
    .join('|');
  return createHash('sha256').update(fingerprint).digest('hex');
}

/**
 * Compute the delta between a previous context snapshot and new context.
 * @param previousEntityIds - Set of entity IDs from the last snapshot
 * @param previousEntities - Full entities from the last snapshot
 * @param newEntities - New entities to compare against
 */
export function computeContextDelta(
  previousEntityIds: Set<string>,
  previousEntities: Map<string, ContextEntity>,
  newEntities: ContextEntity[],
): ContextDelta {
  const newEntityMap = new Map(newEntities.map(e => [e.id, e]));

  const added: ContextEntity[] = [];
  const removed: ContextEntity[] = [];
  const modified: Array<{ entity: ContextEntity; changes: EntityDelta[] }> = [];

  // Find added entities
  for (const entity of newEntities) {
    if (!previousEntityIds.has(entity.id)) {
      added.push(entity);
    }
  }

  // Find removed entities
  for (const [id, entity] of previousEntities) {
    if (!newEntityMap.has(id)) {
      removed.push(entity);
    }
  }

  // Find modified entities
  for (const entity of newEntities) {
    if (!previousEntityIds.has(entity.id)) continue; // already in added

    const prev = previousEntities.get(entity.id);
    if (!prev) continue;

    const changes: EntityDelta[] = [];

    // Check label change
    if (prev.label !== entity.label) {
      changes.push({ field: 'label', oldValue: prev.label, newValue: entity.label });
    }

    // Check attribute changes
    const allKeys = new Set([...Object.keys(prev.attributes), ...Object.keys(entity.attributes)]);
    for (const key of allKeys) {
      const oldVal = prev.attributes[key];
      const newVal = entity.attributes[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field: `attributes.${key}`, oldValue: oldVal, newValue: newVal });
      }
    }

    if (changes.length > 0) {
      modified.push({ entity, changes });
    }
  }

  const deltaEntityCount = added.length + removed.length + modified.length;
  const totalEntityCount = newEntities.length;

  // Token savings = (total full context) - (delta-only tokens)
  const savedTokens = Math.max(0, (totalEntityCount - deltaEntityCount) * TOKENS_PER_ENTITY);
  const totalNewTokens = deltaEntityCount * TOKENS_PER_ENTITY;

  return { added, removed, modified, savedTokens, totalNewTokens };
}

/**
 * Split a delta into token-bounded chunks for streaming.
 * @param delta - Context delta to chunk
 * @param chunkSizeTokens - Max tokens per chunk
 */
export function streamDeltaAsChunks(
  delta: ContextDelta,
  chunkSizeTokens = 500,
): ContextChunk[] {
  const allEntities = [
    ...delta.added,
    ...delta.modified.map(m => m.entity),
  ];

  if (allEntities.length === 0) return [];

  const entitiesPerChunk = Math.max(1, Math.floor(chunkSizeTokens / TOKENS_PER_ENTITY));
  const chunks: ContextChunk[] = [];

  for (let i = 0; i < allEntities.length; i += entitiesPerChunk) {
    const slice = allEntities.slice(i, i + entitiesPerChunk);
    chunks.push({
      chunkIndex: chunks.length,
      totalChunks: Math.ceil(allEntities.length / entitiesPerChunk),
      entities: slice,
      estimatedTokens: slice.length * TOKENS_PER_ENTITY,
    });
  }

  // Update totalChunks once we know the final count
  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length;
  }

  return chunks;
}

/**
 * Encode a delta for compact transmission (entity references vs. full objects for unchanged).
 * @param delta - Delta to encode
 */
export function encodeContextDelta(delta: ContextDelta): Record<string, unknown> {
  return {
    deltaMode: true,
    added: delta.added,
    removed: delta.removed.map(e => ({ id: e.id, type: e.type })),  // references only
    modified: delta.modified.map(m => ({
      id: m.entity.id,
      type: m.entity.type,
      label: m.entity.label,
      changes: m.changes,
    })),
    meta: {
      savedTokens: delta.savedTokens,
      totalNewTokens: delta.totalNewTokens,
      addedCount: delta.added.length,
      removedCount: delta.removed.length,
      modifiedCount: delta.modified.length,
    },
  };
}

/**
 * Capture a context snapshot for a client.
 * @param sql - SQL function
 * @param clientId - MCP client identifier
 * @param workspaceId - Workspace context
 * @param queryHash - Hash of the query that produced this context
 * @param entities - Entities served in this context
 */
export async function captureContextSnapshot(
  sql: SqlFn,
  clientId: string,
  workspaceId: string,
  queryHash: string,
  entities: ContextEntity[],
): Promise<Result<void, Error>> {
  try {
    const snapshot = hashContextSnapshot(entities);
    const entityIds = entities.map(e => e.id);
    const expiresAt = new Date(Date.now() + CLIENT_STATE_TTL_MS);

    await sql`
      INSERT INTO mcp_client_context_state (
        client_id, workspace_id, last_query_hash, last_context_snapshot,
        entities_served, snapshot_created_at, expires_at
      ) VALUES (
        ${clientId}, ${workspaceId}, ${queryHash}, ${snapshot},
        ${entityIds}, NOW(), ${expiresAt}
      )
      ON CONFLICT (client_id, workspace_id) DO UPDATE SET
        last_query_hash = EXCLUDED.last_query_hash,
        last_context_snapshot = EXCLUDED.last_context_snapshot,
        entities_served = EXCLUDED.entities_served,
        snapshot_created_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `;

    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Load the current context state for a client.
 * @param sql - SQL function
 * @param clientId - MCP client identifier
 * @param workspaceId - Workspace context
 */
export async function getClientContextState(
  sql: SqlFn,
  clientId: string,
  workspaceId: string,
): Promise<Result<ClientContextState | null, Error>> {
  try {
    const rows = await sql`
      SELECT client_id, workspace_id, last_query_hash, last_context_snapshot,
             entities_served, snapshot_created_at, expires_at
      FROM mcp_client_context_state
      WHERE client_id = ${clientId}
        AND workspace_id = ${workspaceId}
        AND expires_at > NOW()
    ` as unknown as Array<{
      client_id: string;
      workspace_id: string;
      last_query_hash: string;
      last_context_snapshot: string;
      entities_served: string[];
      snapshot_created_at: string;
      expires_at: string;
    }>;

    if (rows.length === 0) return ok(null);
    const r = rows[0]!;
    return ok({
      clientId: r.client_id,
      workspaceId: r.workspace_id,
      lastQueryHash: r.last_query_hash,
      lastContextSnapshot: r.last_context_snapshot,
      entitiesServed: r.entities_served,
      snapshotCreatedAt: new Date(r.snapshot_created_at),
      expiresAt: new Date(r.expires_at),
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Delete client context state (force full refresh on next query).
 * @param sql - SQL function
 * @param clientId - MCP client identifier
 * @param workspaceId - Workspace context
 */
export async function resetClientState(
  sql: SqlFn,
  clientId: string,
  workspaceId: string,
): Promise<Result<void, Error>> {
  try {
    await sql`
      DELETE FROM mcp_client_context_state
      WHERE client_id = ${clientId} AND workspace_id = ${workspaceId}
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Write a delta audit entry for tracking token savings.
 * @param sql - SQL function
 * @param audit - Audit data to record
 */
export async function writeDeltaAudit(
  sql: SqlFn,
  audit: Omit<ContextDeltaAudit, 'deliveredAt'>,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO context_delta_audit (
        client_id, delta_id, entities_added_count, entities_removed_count,
        entities_modified_count, saved_tokens, stream_chunks, delivered_at
      ) VALUES (
        ${audit.clientId}, ${audit.deltaId}, ${audit.entitiesAddedCount},
        ${audit.entitiesRemovedCount}, ${audit.entitiesModifiedCount},
        ${audit.savedTokens}, ${audit.streamChunks}, NOW()
      )
    `;
    log.info('Delta audit written', { clientId: audit.clientId, savedTokens: audit.savedTokens, streamChunks: audit.streamChunks });
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get delta history for a client (cursor-paginated).
 * @param sql - SQL function
 * @param clientId - MCP client identifier
 * @param workspaceId - Workspace context
 * @param limit - Max entries
 * @param cursor - Pagination cursor
 */
export async function getDeltaHistory(
  sql: SqlFn,
  clientId: string,
  workspaceId: string,
  limit = 20,
  cursor?: string,
): Promise<Result<{ entries: ContextDeltaAudit[]; nextCursor: string | null }, Error>> {
  try {
    // workspaceId used for future multi-tenant filtering
    void workspaceId;

    const rows = cursor
      ? await sql`
          SELECT client_id, delta_id, entities_added_count, entities_removed_count,
                 entities_modified_count, saved_tokens, stream_chunks, delivered_at
          FROM context_delta_audit
          WHERE client_id = ${clientId}
            AND delta_id < ${cursor}
          ORDER BY delivered_at DESC, delta_id DESC
          LIMIT ${limit + 1}
        ` as unknown as Array<{
          client_id: string; delta_id: string;
          entities_added_count: number; entities_removed_count: number;
          entities_modified_count: number; saved_tokens: number;
          stream_chunks: number; delivered_at: string;
        }>
      : await sql`
          SELECT client_id, delta_id, entities_added_count, entities_removed_count,
                 entities_modified_count, saved_tokens, stream_chunks, delivered_at
          FROM context_delta_audit
          WHERE client_id = ${clientId}
          ORDER BY delivered_at DESC, delta_id DESC
          LIMIT ${limit + 1}
        ` as unknown as Array<{
          client_id: string; delta_id: string;
          entities_added_count: number; entities_removed_count: number;
          entities_modified_count: number; saved_tokens: number;
          stream_chunks: number; delivered_at: string;
        }>;

    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit).map(r => ({
      clientId: r.client_id,
      deltaId: r.delta_id,
      entitiesAddedCount: r.entities_added_count,
      entitiesRemovedCount: r.entities_removed_count,
      entitiesModifiedCount: r.entities_modified_count,
      savedTokens: r.saved_tokens,
      streamChunks: r.stream_chunks,
      deliveredAt: new Date(r.delivered_at),
    }));

    return ok({ entries, nextCursor: hasMore ? entries[entries.length - 1]!.deltaId : null });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
