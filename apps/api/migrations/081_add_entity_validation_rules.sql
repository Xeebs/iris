-- Migration 081: Entity Validation Rules & Failures
-- Adds tables for user-defined validation rules and recorded failures.

CREATE TABLE IF NOT EXISTS validation_rules (
  rule_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT        NOT NULL,
  entity_type         TEXT        NOT NULL,
  rule_name           TEXT        NOT NULL,
  rule_definition     JSONB       NOT NULL,
  is_blocking         BOOLEAN     NOT NULL DEFAULT true,
  severity            TEXT        NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning')),
  created_by_user_id  TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_validation_rules_workspace_type
  ON validation_rules (workspace_id, entity_type);

CREATE TABLE IF NOT EXISTS validation_failures (
  failure_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT        NOT NULL,
  entity_id       TEXT        NOT NULL,
  rule_id         UUID        NOT NULL REFERENCES validation_rules (rule_id) ON DELETE CASCADE,
  failure_reason  TEXT        NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged    BOOLEAN     NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,

  CONSTRAINT uq_validation_failure UNIQUE (workspace_id, entity_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_validation_failures_workspace
  ON validation_failures (workspace_id, acknowledged);

CREATE INDEX IF NOT EXISTS idx_validation_failures_entity
  ON validation_failures (entity_id);
