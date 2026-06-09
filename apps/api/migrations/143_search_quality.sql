-- Migration 143: Semantic Search Quality Evaluation & Ranking Debugger
-- Tables for evaluation test sets, A/B experiments, and result tracking.

CREATE TABLE IF NOT EXISTS search_quality_test_sets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  queries      JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS search_quality_test_sets_workspace_idx ON search_quality_test_sets (workspace_id);

CREATE TABLE IF NOT EXISTS search_experiments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  name                TEXT NOT NULL,
  control_strategy    TEXT NOT NULL CHECK (control_strategy IN ('vector', 'bm25', 'hybrid')),
  treatment_strategy  TEXT NOT NULL CHECK (treatment_strategy IN ('vector', 'bm25', 'hybrid')),
  test_set_id         UUID REFERENCES search_quality_test_sets(id),
  traffic_pct         INT NOT NULL DEFAULT 10 CHECK (traffic_pct >= 0 AND traffic_pct <= 100),
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'promoted', 'abandoned')),
  winner              TEXT CHECK (winner IN ('vector', 'bm25', 'hybrid')),
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_experiments_workspace_status_idx ON search_experiments (workspace_id, status);
CREATE INDEX IF NOT EXISTS search_experiments_created_at_idx ON search_experiments (created_at DESC);

CREATE TABLE IF NOT EXISTS search_experiment_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id   UUID NOT NULL REFERENCES search_experiments(id) ON DELETE CASCADE,
  strategy_name   TEXT NOT NULL,
  precision_at_5  NUMERIC(6, 4) NOT NULL DEFAULT 0,
  recall_at_10    NUMERIC(6, 4) NOT NULL DEFAULT 0,
  ndcg            NUMERIC(6, 4) NOT NULL DEFAULT 0,
  mrr             NUMERIC(6, 4) NOT NULL DEFAULT 0,
  sample_size     INT NOT NULL DEFAULT 1,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_experiment_results_exp_idx ON search_experiment_results (experiment_id, strategy_name);
