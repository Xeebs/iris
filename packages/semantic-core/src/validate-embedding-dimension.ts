import type postgres from 'postgres';

import { IndexerError } from '@iris/core/errors';

import { createDefaultProvider } from './embedding-provider.js';

type SqlClient = ReturnType<typeof postgres>;

/**
 * Pre-flight check that the configured embedding provider's vector dimension
 * matches the iris_entities schema column.
 *
 * Call this at startup before PgvectorStore.initialize() to surface a mismatch
 * early with a clear, actionable error message referencing the correct migration.
 *
 * - No-ops if iris_entities does not yet exist (migrations will create it).
 * - No-ops if the embedding column has no dimension constraint (atttypmod = -1).
 * - Throws IndexerError if storedDim ≠ providerDim.
 *
 * @param sql - Connected postgres.js client
 */
export async function validateEmbeddingDimension(sql: SqlClient): Promise<void> {
  const provider = createDefaultProvider();
  const expectedDim = provider.getModelDimensions();

  const rows = await sql<Array<{ atttypmod: number }>>`
    SELECT atttypmod
    FROM pg_attribute
    WHERE attrelid = 'iris_entities'::regclass
      AND attname = 'embedding'
      AND NOT attisdropped
  `.catch(() => [] as Array<{ atttypmod: number }>);

  if (rows.length === 0) return;

  const storedDim = rows[0]!.atttypmod;
  if (storedDim === -1) return;

  if (storedDim !== expectedDim) {
    const providerName = process.env['EMBEDDING_PROVIDER'] ?? 'openai';
    const migrationHint =
      providerName === 'ollama'
        ? 'Run apps/api/migrations/183_embedding_dimension_ollama.sql to switch to vector(768).'
        : 'Run apps/api/migrations/182_embedding_dimension_768.sql to reset to vector(1536).';
    throw new IndexerError(
      `Embedding dimension mismatch: schema has vector(${storedDim}) but ` +
        `EMBEDDING_PROVIDER=${providerName} provides ${expectedDim}-dimensional vectors. ` +
        `${migrationHint} ` +
        `See docs/CONNECT_CLAUDE.md#troubleshooting.`,
    );
  }
}
