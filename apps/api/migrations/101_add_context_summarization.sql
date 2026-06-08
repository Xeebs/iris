-- Context summarization: style preferences and metrics

CREATE TABLE IF NOT EXISTS summarization_styles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  query_intent_pattern  TEXT NOT NULL,
  preferred_style       TEXT NOT NULL CHECK (preferred_style IN ('bullet_list', 'json', 'prose', 'table')),
  applied_count         INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, query_intent_pattern)
);

CREATE INDEX IF NOT EXISTS idx_summarization_styles_workspace
  ON summarization_styles (workspace_id, query_intent_pattern);

CREATE TABLE IF NOT EXISTS summary_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  original_token_count  INTEGER NOT NULL,
  summary_token_count   INTEGER NOT NULL,
  compression_ratio     NUMERIC(6, 4) NOT NULL DEFAULT 0,
  user_satisfaction_score NUMERIC(3, 2) CHECK (user_satisfaction_score BETWEEN 0 AND 1),
  query_intent          TEXT NOT NULL,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summary_metrics_workspace
  ON summary_metrics (workspace_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_summary_metrics_intent
  ON summary_metrics (workspace_id, query_intent);
