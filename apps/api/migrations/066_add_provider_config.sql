CREATE TABLE IF NOT EXISTS workspace_provider_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  provider_id       TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 1,
  api_key_encrypted TEXT,
  endpoint_override TEXT,
  is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_config_workspace
  ON workspace_provider_configs (workspace_id, is_enabled, priority);
