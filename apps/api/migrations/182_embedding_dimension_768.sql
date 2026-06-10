-- Migration 182: Repair iris_entities embedding column + rebuild compat views.
-- Drops and recreates the embedding column (keeping the default 1536-dim for
-- OpenAI text-embedding-3-small and the hash-deterministic CI provider).
-- CASCADE removes the compat views from migration 180 which reference the column;
-- they are recreated below with the same definition.
-- For Ollama (768-dim) deployments, run 183_embedding_dimension_ollama.sql after
-- setting EMBEDDING_PROVIDER=ollama.

DROP INDEX IF EXISTS iris_entities_embedding_idx;

-- CASCADE drops the compatibility views from migration 180 that reference this column.
-- They are recreated below with the same definition.
ALTER TABLE iris_entities DROP COLUMN IF EXISTS embedding CASCADE;
ALTER TABLE iris_entities ADD COLUMN embedding vector(1536);

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
