-- Search quality evaluation: test sets, experiments, and metric results
CREATE TABLE IF NOT EXISTS search_quality_test_sets (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  queries         JSONB       NOT NULL DEFAULT '[]',  -- [{query, expectedEntityIds, relevanceScores}]
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_test_sets_workspace
  ON search_quality_test_sets (workspace_id);

CREATE TABLE IF NOT EXISTS search_experiments (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id        TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  control_strategy    TEXT        NOT NULL,  -- 'vector' | 'bm25' | 'hybrid'
  treatment_strategy  TEXT        NOT NULL,
  test_set_id         UUID        REFERENCES search_quality_test_sets(id) ON DELETE SET NULL,
  traffic_pct         INTEGER     NOT NULL DEFAULT 10,  -- % of traffic to treatment
  status              TEXT        NOT NULL DEFAULT 'running', -- 'running' | 'paused' | 'promoted' | 'abandoned'
  winner              TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_experiments_workspace
  ON search_experiments (workspace_id, status);

CREATE TABLE IF NOT EXISTS search_experiment_results (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id       UUID        NOT NULL REFERENCES search_experiments(id) ON DELETE CASCADE,
  strategy_name       TEXT        NOT NULL,
  precision_at_5      NUMERIC(5,4),
  recall_at_10        NUMERIC(5,4),
  ndcg                NUMERIC(5,4),
  mrr                 NUMERIC(5,4),
  sample_size         INTEGER     NOT NULL DEFAULT 0,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_exp
  ON search_experiment_results (experiment_id, recorded_at DESC);
