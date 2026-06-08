-- Data lineage: entity origin provenance and cross-entity dependency graph.

CREATE TABLE IF NOT EXISTS entity_lineage (
  id                    BIGSERIAL       PRIMARY KEY,
  entity_id             TEXT            NOT NULL,
  workspace_id          TEXT            NOT NULL,
  source_connector_id   TEXT            NOT NULL DEFAULT 'unknown',
  source_sync_job_id    TEXT,
  source_api_timestamp  TIMESTAMPTZ,
  lineage_json          JSONB           NOT NULL DEFAULT '{"transformations":[]}',
  last_modified_by      TEXT            NOT NULL DEFAULT 'system',
  last_modified_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT entity_lineage_uq UNIQUE (entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS entity_lineage_workspace_idx ON entity_lineage (workspace_id, last_modified_at DESC);
CREATE INDEX IF NOT EXISTS entity_lineage_connector_idx ON entity_lineage (source_connector_id);

CREATE TABLE IF NOT EXISTS entity_dependencies (
  id                    BIGSERIAL   PRIMARY KEY,
  entity_id             TEXT        NOT NULL,
  depends_on_entity_id  TEXT        NOT NULL,
  workspace_id          TEXT        NOT NULL,
  relationship_type     TEXT        NOT NULL DEFAULT 'references'
    CHECK (relationship_type IN ('references', 'contains', 'derived_from', 'shares_owner')),
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT entity_dependencies_uq UNIQUE (entity_id, depends_on_entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS entity_deps_entity_idx    ON entity_dependencies (entity_id, workspace_id);
CREATE INDEX IF NOT EXISTS entity_deps_depends_idx   ON entity_dependencies (depends_on_entity_id, workspace_id);

CREATE TABLE IF NOT EXISTS query_entity_map (
  id               BIGSERIAL    PRIMARY KEY,
  query_id         TEXT         NOT NULL,
  workspace_id     TEXT         NOT NULL,
  entity_id        TEXT         NOT NULL,
  context_position INTEGER,
  accessed_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS query_entity_map_query_idx  ON query_entity_map (query_id);
CREATE INDEX IF NOT EXISTS query_entity_map_entity_idx ON query_entity_map (entity_id, workspace_id);
