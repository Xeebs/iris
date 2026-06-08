-- Core semantic entity store table, required by the VectorStore runtime.
-- Must run before any migration that alters iris_entities.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS iris_entities (
  id            TEXT        PRIMARY KEY,
  workspace_id  TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  attributes    JSONB       NOT NULL DEFAULT '{}',
  relationships JSONB       NOT NULL DEFAULT '[]',
  last_modified TIMESTAMPTZ NOT NULL,
  source_id     TEXT        NOT NULL,
  embedding     vector(1536),
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS iris_entities_embedding_idx
  ON iris_entities USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS iris_entities_workspace_idx ON iris_entities (workspace_id);
CREATE INDEX IF NOT EXISTS iris_entities_type_idx      ON iris_entities (type);
