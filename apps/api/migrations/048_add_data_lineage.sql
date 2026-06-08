-- Tracks data provenance: where each entity came from and how it was transformed.
-- One record per entity; transformations accumulated in lineage_json.

CREATE TABLE IF NOT EXISTS entity_lineage (
  id                    BIGSERIAL       PRIMARY KEY,
  entity_id             TEXT            NOT NULL,
  workspace_id          TEXT            NOT NULL,
  source_connector_id   TEXT            NOT NULL,
  source_sync_job_id    TEXT,
  source_api_timestamp  TIMESTAMPTZ,
  lineage_json          JSONB           NOT NULL DEFAULT '{"transformations":[]}',
  last_modified_by      TEXT            NOT NULL DEFAULT 'system',
  last_modified_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_lineage_workspace
  ON entity_lineage (workspace_id, last_modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_lineage_connector
  ON entity_lineage (workspace_id, source_connector_id);
