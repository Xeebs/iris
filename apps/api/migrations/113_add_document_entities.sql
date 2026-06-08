-- Migration 113: Add indexed_documents table for native document indexing
-- Stores extracted plaintext from connector document sources (Google Drive, Notion, Confluence, etc.)
-- with full-text search (FTS) support via tsvector.

CREATE TABLE IF NOT EXISTS indexed_documents (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT          NOT NULL,
  source_connector_id TEXT          NOT NULL,
  source_entity_id    TEXT          NOT NULL,
  document_title      TEXT          NOT NULL DEFAULT '',
  content_plaintext   TEXT          NOT NULL DEFAULT '',
  content_hash        TEXT          NOT NULL,
  token_estimate      INTEGER       NOT NULL DEFAULT 0,
  extracted_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_entity_id)
);

-- Full-text search index on document content
CREATE INDEX IF NOT EXISTS idx_indexed_documents_fts
  ON indexed_documents
  USING GIN (to_tsvector('english', content_plaintext));

-- Workspace + connector lookup index
CREATE INDEX IF NOT EXISTS idx_indexed_documents_workspace_connector
  ON indexed_documents (workspace_id, source_connector_id);

-- Recency index for ordering by extraction time
CREATE INDEX IF NOT EXISTS idx_indexed_documents_extracted_at
  ON indexed_documents (workspace_id, extracted_at DESC);
