-- Migration 182: Align iris_entities embedding column with Ollama nomic-embed-text (768-dim)
-- Replaces the historical vector(1536) column (OpenAI text-embedding-3-small) with vector(768).
-- All indexed data must be re-indexed after running this migration.
-- On a fresh demo database this is a no-op rebuild; on a populated database it signals a re-index.

DROP INDEX IF EXISTS iris_entities_embedding_idx;

ALTER TABLE iris_entities DROP COLUMN IF EXISTS embedding;
ALTER TABLE iris_entities ADD COLUMN embedding vector(768);

CREATE INDEX iris_entities_embedding_idx
  ON iris_entities USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
