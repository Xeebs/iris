-- Schema overrides store human-confirmed field decisions for connectors that
-- use auto-discovery (CSV, JSON, Parquet, custom APIs).
-- The fields column is a JSONB array of SchemaFieldDecision objects.

CREATE TABLE IF NOT EXISTS schema_overrides (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   TEXT         NOT NULL,
  workspace_id  TEXT         NOT NULL,
  entity_type   TEXT         NOT NULL,
  fields        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT schema_overrides_unique UNIQUE (instance_id, entity_type)
);

CREATE INDEX IF NOT EXISTS schema_overrides_instance
  ON schema_overrides (instance_id, workspace_id);

CREATE INDEX IF NOT EXISTS schema_overrides_workspace
  ON schema_overrides (workspace_id);
