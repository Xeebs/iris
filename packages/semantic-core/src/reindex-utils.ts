import type postgres from 'postgres';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';
import type { AttributeValue } from '@iris/connector-sdk';

import type { EmbeddingProvider } from './embedding-provider.js';
import type { VectorStore } from './vector-store.js';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'reindex-utils' });

const REINDEX_BATCH_SIZE = 100;
const MAX_REINDEX_TOKENS = 500_000;

type EntityRow = {
  id: string;
  workspace_id: string;
  label: string;
  entity_type: string;
  attributes: Record<string, unknown>;
};

/**
 * Record which embedding model was used to index entities for a workspace.
 *
 * @param sql         - Postgres client
 * @param workspaceId - Target workspace
 * @param modelId     - Model identifier string
 * @param dimension   - Vector dimensionality
 */
export async function recordEmbeddingMetadata(
  sql: SqlClient,
  workspaceId: string,
  modelId: string,
  dimension: number,
): Promise<void> {
  await sql`
    INSERT INTO embedding_metadata (workspace_id, model_id, dimension, created_at)
    VALUES (${workspaceId}, ${modelId}, ${dimension}, now())
    ON CONFLICT (workspace_id) DO UPDATE
      SET model_id = EXCLUDED.model_id,
          dimension = EXCLUDED.dimension,
          created_at = now()
  `;
}

/**
 * Get the current embedding model metadata for a workspace.
 *
 * @param sql         - Postgres client
 * @param workspaceId - Target workspace
 * @returns           - Model metadata, or null if not set
 */
export async function getEmbeddingMetadata(
  sql: SqlClient,
  workspaceId: string,
): Promise<{ modelId: string; dimension: number; createdAt: Date } | null> {
  const rows = await sql<{ model_id: string; dimension: number; created_at: Date }[]>`
    SELECT model_id, dimension, created_at FROM embedding_metadata
    WHERE workspace_id = ${workspaceId}
  `;
  const row = rows[0];
  if (!row) return null;
  return { modelId: row.model_id, dimension: row.dimension, createdAt: row.created_at };
}

export type ReindexOptions = {
  batchSize?: number;
  dryRun?: boolean;
};

type ReindexResult = {
  entitiesProcessed: number;
  batchesCompleted: number;
  tokensEstimated: number;
  durationMs: number;
};

/**
 * Migrate all indexed entities for a workspace from one embedding model to another.
 * Reads entities from Postgres, re-embeds with the new provider, and upserts into the vector store.
 *
 * @param sql             - Postgres client
 * @param vectorStore     - Target vector store
 * @param workspaceId     - Workspace to migrate
 * @param newProvider     - New embedding provider to use
 * @param options         - Optional batch size / dry-run control
 */
export async function reindexWorkspace(
  sql: SqlClient,
  vectorStore: VectorStore,
  workspaceId: string,
  newProvider: EmbeddingProvider,
  options: ReindexOptions = {},
): Promise<ReindexResult> {
  const batchSize = options.batchSize ?? REINDEX_BATCH_SIZE;
  const dryRun = options.dryRun ?? false;

  const start = Date.now();
  let entitiesProcessed = 0;
  let batchesCompleted = 0;
  let tokensEstimated = 0;
  let cursor = '';

  log.info('Starting workspace reindex', {
    workspaceId,
    provider: newProvider.getModelId(),
    dryRun,
  });

  for (;;) {
    const rows = await sql<EntityRow[]>`
      SELECT id, workspace_id, label, entity_type, attributes
      FROM entities
      WHERE workspace_id = ${workspaceId}
        AND id > ${cursor}
      ORDER BY id
      LIMIT ${batchSize}
    `;

    if (rows.length === 0) break;

    const texts = rows.map((r) => {
      const attrs = Object.entries(r.attributes ?? {})
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(', ') : String(v)}`)
        .join('; ');
      return `${r.entity_type}: ${r.label}${attrs ? `. ${attrs}` : ''}`;
    });

    const batchTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    tokensEstimated += batchTokens;

    if (tokensEstimated > MAX_REINDEX_TOKENS) {
      log.warn('Reindex token budget exceeded — stopping early', {
        workspaceId,
        tokensEstimated,
        budget: MAX_REINDEX_TOKENS,
      });
      break;
    }

    if (!dryRun) {
      let vectors: number[][];
      try {
        vectors = await newProvider.batchEmbeddings(texts);
      } catch (e) {
        throw new IndexerError(
          `Reindex embedding batch failed at cursor ${cursor}: ${e instanceof Error ? e.message : String(e)}`,
          e,
        );
      }

      const entities = rows.map((row, idx) => ({
        id: row.id,
        type: row.entity_type,
        label: row.label,
        attributes: row.attributes as Record<string, AttributeValue>,
        relationships: [],
        lastModified: new Date(),
        sourceId: row.id,
      }));

      await vectorStore.upsert(entities, vectors);
    }

    entitiesProcessed += rows.length;
    batchesCompleted++;
    cursor = rows[rows.length - 1]!.id;

    log.info('Reindex batch complete', {
      workspaceId,
      batchesCompleted,
      entitiesProcessed,
      tokensEstimated,
    });
  }

  if (!dryRun) {
    await recordEmbeddingMetadata(
      sql,
      workspaceId,
      newProvider.getModelId(),
      newProvider.getModelDimensions(),
    );
  }

  const durationMs = Date.now() - start;
  log.info('Workspace reindex complete', {
    workspaceId,
    entitiesProcessed,
    batchesCompleted,
    tokensEstimated,
    durationMs,
    dryRun,
  });

  return { entitiesProcessed, batchesCompleted, tokensEstimated, durationMs };
}
