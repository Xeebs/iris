-- Track which embedding model version has been used to index each workspace's entities.
-- One row per workspace; updated when provider is changed or migration completes.

CREATE TABLE IF NOT EXISTS embedding_metadata (
  workspace_id  TEXT        NOT NULL,
  model_id      TEXT        NOT NULL,
  dimension     INTEGER     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT embedding_metadata_pkey PRIMARY KEY (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_metadata_model ON embedding_metadata (model_id);
