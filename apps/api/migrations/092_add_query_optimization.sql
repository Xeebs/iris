-- Query optimizer: execution plan history and effectiveness metrics.

CREATE TABLE IF NOT EXISTS query_execution_plans (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash            TEXT          NOT NULL,
  workspace_id          TEXT          NOT NULL,
  strategy_chosen       TEXT          NOT NULL
    CHECK (strategy_chosen IN ('vector_search_only', 'graph_expansion_first', 'cache_check_first', 'parallel_hybrid')),
  estimated_cost_tokens INTEGER       NOT NULL DEFAULT 0,
  actual_cost_tokens    INTEGER,
  latency_ms            INTEGER,
  cache_hit             BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qep_workspace_idx       ON query_execution_plans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qep_hash_idx            ON query_execution_plans (query_hash, workspace_id);
CREATE INDEX IF NOT EXISTS qep_strategy_idx        ON query_execution_plans (strategy_chosen, workspace_id);
