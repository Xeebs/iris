-- Migration 114: Add search relevance tuning tables
-- search_tuning_config: per-workspace scoring factor overrides
-- search_feedback: click-through signals for learning-to-rank

CREATE TABLE IF NOT EXISTS search_tuning_config (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT          NOT NULL,
  factor_name  TEXT          NOT NULL,
  tuned_value  DOUBLE PRECISION NOT NULL,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, factor_name)
);

CREATE INDEX IF NOT EXISTS idx_search_tuning_workspace
  ON search_tuning_config (workspace_id);

CREATE TABLE IF NOT EXISTS search_feedback (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT          NOT NULL,
  query            TEXT          NOT NULL,
  clicked_entity_id TEXT         NOT NULL,
  rank             INTEGER       NOT NULL,
  feedback_score   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  dwell_time_ms    INTEGER,
  timestamp        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_feedback_workspace_ts
  ON search_feedback (workspace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_search_feedback_query
  ON search_feedback (workspace_id, query);
