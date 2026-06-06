-- Tracks how many entities of each type have been indexed per workspace.
-- Updated via upsert each time a sync completes for a given entity type.

CREATE TABLE IF NOT EXISTS index_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_count    INTEGER NOT NULL DEFAULT 0,
  total_bytes     BIGINT NOT NULL DEFAULT 0,
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT index_status_unique UNIQUE (workspace_id, entity_type)
);

CREATE INDEX IF NOT EXISTS index_status_workspace
  ON index_status (workspace_id);
