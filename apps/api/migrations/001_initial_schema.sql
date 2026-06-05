-- Core tenant and connector instance tables.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_instances (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_id    TEXT        NOT NULL,
  config          JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'error', 'syncing')),
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_instances_workspace
  ON connector_instances(workspace_id);

CREATE INDEX IF NOT EXISTS idx_connector_instances_workspace_connector
  ON connector_instances(workspace_id, connector_id);
