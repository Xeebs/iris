-- Migration 170: workflow_sessions and workflow_execution_logs

CREATE TABLE IF NOT EXISTS workflow_sessions (
  session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  template_id    TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  parameters     JSONB NOT NULL DEFAULT '{}',
  result_summary TEXT,
  token_usage    INTEGER,
  execution_ms   INTEGER,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_sessions_user
  ON workflow_sessions (user_id, workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_sessions_workspace
  ON workflow_sessions (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS workflow_execution_logs (
  log_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES workflow_sessions (session_id) ON DELETE CASCADE,
  step_index     INTEGER NOT NULL,
  tool_name      TEXT NOT NULL,
  tool_params    JSONB NOT NULL DEFAULT '{}',
  tool_response  TEXT,
  token_count    INTEGER,
  latency_ms     INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'error')),
  error_message  TEXT,
  executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_execution_logs_session
  ON workflow_execution_logs (session_id, step_index);
