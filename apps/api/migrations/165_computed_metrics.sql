-- Migration 165: Computed metric definitions and computation audit log

CREATE TABLE IF NOT EXISTS computed_metrics (
  metric_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  formula_text TEXT NOT NULL,
  formula_ast JSONB NOT NULL,
  description TEXT,
  last_computed_value NUMERIC,
  last_computed_at TIMESTAMPTZ,
  computation_status TEXT CHECK (computation_status IN ('success', 'error', 'pending')) DEFAULT 'pending',
  computation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_computed_metrics_workspace ON computed_metrics (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_computed_metrics_name ON computed_metrics (workspace_id, name);

CREATE TABLE IF NOT EXISTS metric_computation_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id TEXT NOT NULL REFERENCES computed_metrics(metric_id) ON DELETE CASCADE,
  computed_value NUMERIC,
  entity_count_used INTEGER NOT NULL DEFAULT 0,
  execution_time_ms NUMERIC NOT NULL DEFAULT 0,
  error_message TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metric_log_metric ON metric_computation_log (metric_id, computed_at DESC);
