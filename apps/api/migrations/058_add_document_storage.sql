-- Migration 058: Document storage for full-text indexing

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
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_indexed_documents_fts
  ON indexed_documents
  USING GIN (to_tsvector('english', content_plaintext));

-- Workspace + connector lookup for stats and bulk delete
CREATE INDEX IF NOT EXISTS idx_indexed_documents_workspace_connector
  ON indexed_documents (workspace_id, source_connector_id);

-- Fast hash comparison to skip unchanged documents
CREATE INDEX IF NOT EXISTS idx_indexed_documents_hash
  ON indexed_documents (workspace_id, source_entity_id, content_hash);
