-- Migration 075: Schema Evolution & Connector Schema Versioning

CREATE TABLE connector_schema_versions (
  id              BIGSERIAL PRIMARY KEY,
  connector_id    TEXT NOT NULL,
  version         TEXT NOT NULL,
  schema_json     JSONB NOT NULL,
  released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  breaking_changes_json JSONB NOT NULL DEFAULT '[]',
  migration_guide TEXT,
  UNIQUE (connector_id, version)
);

CREATE INDEX idx_schema_versions_connector ON connector_schema_versions(connector_id, released_at DESC);

CREATE TABLE schema_migrations (
  id                    BIGSERIAL PRIMARY KEY,
  workspace_id          UUID NOT NULL,
  connector_id          TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  target_schema_version TEXT NOT NULL,
  migration_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (migration_status IN ('pending', 'in_progress', 'completed', 'failed')),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  affected_entity_count INTEGER,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id, source_schema_version, target_schema_version)
);

CREATE INDEX idx_schema_migrations_workspace ON schema_migrations(workspace_id, connector_id);
CREATE INDEX idx_schema_migrations_status ON schema_migrations(migration_status) WHERE migration_status IN ('pending', 'in_progress');
