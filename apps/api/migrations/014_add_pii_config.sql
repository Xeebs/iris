-- PII configuration per workspace.
-- Stores auto-detection settings and the tokenization key (encrypted at rest via app).

CREATE TABLE IF NOT EXISTS pii_configs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT         NOT NULL UNIQUE,
  enable_auto_detection BOOLEAN      NOT NULL DEFAULT true,
  default_strategy      TEXT         NOT NULL DEFAULT 'redact'
                                     CHECK (default_strategy IN ('redact', 'hash', 'tokenize')),
  tokenization_key      TEXT         NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Per-field PII overrides for a workspace.
-- Allows administrators to configure specific fields that should always be masked
-- regardless of auto-detection, or with a strategy different from the workspace default.

CREATE TABLE IF NOT EXISTS pii_field_configs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   TEXT         NOT NULL,
  field_name     TEXT         NOT NULL,
  strategy       TEXT         NOT NULL DEFAULT 'redact'
                              CHECK (strategy IN ('redact', 'hash', 'tokenize')),
  custom_pattern TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pii_field_configs_unique_field UNIQUE (workspace_id, field_name)
);

CREATE INDEX IF NOT EXISTS pii_field_configs_workspace
  ON pii_field_configs (workspace_id);
