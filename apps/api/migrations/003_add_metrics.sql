-- Metric definition registry per workspace.

CREATE TABLE IF NOT EXISTS metrics (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id  TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  formula       TEXT        NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_metrics_workspace
  ON metrics(workspace_id);
