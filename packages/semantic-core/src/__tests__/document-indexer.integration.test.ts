import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { DocumentIndexer } from '../document-indexer.js';

/** Requires: docker-compose up -d (Postgres on 5432) */
describe.skip('DocumentIndexer — integration', () => {
  let sql: ReturnType<typeof postgres>;
  let indexer: DocumentIndexer;

  beforeAll(async () => {
    sql = postgres({
      host: process.env['POSTGRES_HOST'] ?? 'localhost',
      port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
      database: process.env['POSTGRES_DB'] ?? 'iris_test',
      username: process.env['POSTGRES_USER'] ?? 'postgres',
      password: process.env['POSTGRES_PASSWORD'] ?? 'postgres',
    });

    await sql`
      CREATE TABLE IF NOT EXISTS indexed_documents (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id         text NOT NULL,
        source_connector_id  text NOT NULL,
        source_entity_id     text NOT NULL,
        document_title       text NOT NULL DEFAULT '',
        content_plaintext    text NOT NULL,
        content_hash         text NOT NULL,
        token_estimate       integer NOT NULL DEFAULT 0,
        extracted_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, source_entity_id)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_docs_fts
        ON indexed_documents USING GIN (to_tsvector('english', content_plaintext))
    `;
    await sql`TRUNCATE indexed_documents`;
    indexer = new DocumentIndexer(sql);
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS indexed_documents`;
    await sql.end();
  });

  it('inserts, queries, and deletes a document round-trip', async () => {
    const inserted = await indexer.indexDocument({
      workspaceId: 'ws-integration',
      sourceConnectorId: 'gdrive-test',
      sourceEntityId: 'file-integration-1',
      documentTitle: 'Service Agreement',
      contentPlaintext: 'The payment terms are net-30. Invoices must be paid within 30 calendar days.',
    });
    expect(inserted).toBe(true);

    const results = await indexer.searchDocuments('ws-integration', 'payment terms');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.documentTitle).toBe('Service Agreement');
    expect(results[0]!.excerpt).toContain('payment');

    const deleted = await indexer.deleteByConnector('ws-integration', 'gdrive-test');
    expect(deleted).toBe(1);

    const afterDelete = await indexer.searchDocuments('ws-integration', 'payment terms');
    expect(afterDelete).toHaveLength(0);
  });

  it('skips re-index when content is unchanged', async () => {
    const content = 'Stable document that does not change.';
    await indexer.indexDocument({
      workspaceId: 'ws-integration',
      sourceConnectorId: 'c-stable',
      sourceEntityId: 'e-stable',
      documentTitle: 'Stable',
      contentPlaintext: content,
    });

    const second = await indexer.indexDocument({
      workspaceId: 'ws-integration',
      sourceConnectorId: 'c-stable',
      sourceEntityId: 'e-stable',
      documentTitle: 'Stable',
      contentPlaintext: content,
    });
    expect(second).toBe(false);
  });

  it('returns per-connector stats after indexing', async () => {
    await indexer.indexDocument({
      workspaceId: 'ws-integration',
      sourceConnectorId: 'stats-connector',
      sourceEntityId: 'e-stats-1',
      documentTitle: 'Doc 1',
      contentPlaintext: 'Content alpha',
    });

    const stats = await indexer.getIndexingStats('ws-integration');
    const connector = stats.find((s) => s.sourceConnectorId === 'stats-connector');
    expect(connector).toBeDefined();
    expect(connector!.documentCount).toBeGreaterThanOrEqual(1);
    expect(connector!.totalTokens).toBeGreaterThan(0);
  });
});
