-- Upgrade entity linking schema: add merge tracking table
-- The entity_cross_connector_links table already exists from earlier migrations

CREATE TABLE IF NOT EXISTS entity_merges (
  merge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_entity_merges_workspace ON entity_merges (workspace_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_merges_entities ON entity_merges (source_entity_id, target_entity_id);
