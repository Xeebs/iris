-- Migration 153: Query Execution Plans for Multi-Connector Optimizer

CREATE TABLE IF NOT EXISTS query_execution_plans (
  plan_id          TEXT        NOT NULL,
  workspace_id     TEXT        NOT NULL,
  query            TEXT        NOT NULL,
  strategy         TEXT        NOT NULL CHECK (strategy IN ('parallel', 'sequential', 'filtered-first', 'cached-first')),
  connectors       TEXT[]      NOT NULL DEFAULT '{}',
  estimated_latency_p95_ms  INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER     NOT NULL DEFAULT 0,
  estimated_cost   NUMERIC(10, 4) NOT NULL DEFAULT 0,
  strategy_rankings JSONB      NOT NULL DEFAULT '[]',
  reasoning        TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id)
);

CREATE INDEX IF NOT EXISTS idx_query_execution_plans_workspace
  ON query_execution_plans (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_execution_plans_strategy
  ON query_execution_plans (strategy, created_at DESC);

-- Strategy history: one row per strategy evaluation aggregated per day
CREATE TABLE IF NOT EXISTS execution_strategy_history (
  id               BIGSERIAL   PRIMARY KEY,
  workspace_id     TEXT        NOT NULL,
  strategy         TEXT        NOT NULL CHECK (strategy IN ('parallel', 'sequential', 'filtered-first', 'cached-first')),
  date             DATE        NOT NULL DEFAULT CURRENT_DATE,
  plan_count       INTEGER     NOT NULL DEFAULT 0,
  avg_latency_p95_ms NUMERIC(10, 2) NOT NULL DEFAULT 0,
  avg_tokens       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  avg_cost         NUMERIC(10, 4) NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, strategy, date)
);

CREATE INDEX IF NOT EXISTS idx_execution_strategy_history_workspace
  ON execution_strategy_history (workspace_id, date DESC);
