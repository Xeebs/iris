-- Migration 158: Query execution results for plan visualization

CREATE TABLE IF NOT EXISTS query_execution_results (
  result_id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id             TEXT REFERENCES query_execution_plans(plan_id) ON DELETE SET NULL,
  workspace_id        TEXT NOT NULL,
  actual_latency_ms   INTEGER NOT NULL,
  actual_token_cost   INTEGER NOT NULL DEFAULT 0,
  strategy_used       TEXT NOT NULL CHECK (strategy_used IN ('parallel', 'sequential', 'filtered-first', 'cached-first')),
  connector_timings   JSONB NOT NULL DEFAULT '{}',
  cache_hits          INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,
  executed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qer_workspace ON query_execution_results (workspace_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_qer_plan ON query_execution_results (plan_id);
CREATE INDEX IF NOT EXISTS idx_qer_strategy ON query_execution_results (strategy_used);
