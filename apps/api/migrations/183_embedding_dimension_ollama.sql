-- Migration 183: Switch iris_entities embedding column to vector(768) for Ollama deployments.
-- @requires-env EMBEDDING_PROVIDER=ollama
--
-- Run this migration when EMBEDDING_PROVIDER=ollama (nomic-embed-text, 768 dimensions).
-- Migration 182 created the default vector(1536) column (OpenAI / hash-deterministic).
-- This migration is idempotent: re-running it is safe but will clear all stored embeddings,
-- requiring a full re-sync.
--
-- After running this migration:
--   1. Set EMBEDDING_PROVIDER=ollama and ensure Ollama + nomic-embed-text are running.
--   2. Trigger a full connector sync to re-index all entities with 768-dim vectors.

DROP INDEX IF EXISTS iris_entities_embedding_idx;

-- CASCADE drops the compat views from migration 180 that reference this column.
-- They are recreated below with the same definition.
ALTER TABLE iris_entities DROP COLUMN IF EXISTS embedding CASCADE;
ALTER TABLE iris_entities ADD COLUMN embedding vector(768);

CREATE INDEX iris_entities_embedding_idx
  ON iris_entities USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Recreate compatibility views removed by CASCADE (originally from migration 180).
DROP VIEW IF EXISTS indexed_entities;
CREATE VIEW indexed_entities AS
SELECT
  id,
  workspace_id,
  type,
  type AS entity_type,
  label,
  attributes,
  relationships,
  last_modified,
  source_id,
  split_part(source_id, ':', 1) AS source_connector_id,
  embedding,
  indexed_at
FROM iris_entities;

DROP VIEW IF EXISTS entity_vectors;
CREATE VIEW entity_vectors AS
SELECT
  id AS entity_id,
  workspace_id,
  embedding
FROM iris_entities
WHERE embedding IS NOT NULL;
