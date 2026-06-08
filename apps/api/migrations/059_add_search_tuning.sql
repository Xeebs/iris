-- Migration 059: Search relevance tuning tables

CREATE TABLE IF NOT EXISTS search_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      text NOT NULL,
  query             text NOT NULL,
  clicked_entity_id text NOT NULL,
  rank              integer NOT NULL,
  feedback_score    real NOT NULL DEFAULT 1.0,
  dwell_time_ms     integer,
  timestamp         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_feedback_workspace_ts
  ON search_feedback (workspace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_search_feedback_query
  ON search_feedback (workspace_id, query);

CREATE TABLE IF NOT EXISTS search_tuning_config (
  workspace_id  text NOT NULL,
  factor_name   text NOT NULL,
  tuned_value   real NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, factor_name)
);
