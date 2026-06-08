-- Migration 083: Custom Transformation Rules
-- Stores user-defined entity transformation pipeline rules.

CREATE TABLE IF NOT EXISTS transformation_rules (
  rule_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  connector_id  TEXT,
  entity_type   TEXT,
  rule_name     TEXT        NOT NULL,
  steps         JSONB       NOT NULL DEFAULT '[]',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transformation_rules_workspace
  ON transformation_rules (workspace_id, connector_id, entity_type);
