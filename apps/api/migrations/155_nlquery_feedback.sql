-- Migration 155: NL Query Sessions and Feedback

CREATE TABLE IF NOT EXISTS nlquery_sessions (
  session_id          TEXT        NOT NULL PRIMARY KEY,
  workspace_id        TEXT        NOT NULL,
  question            TEXT        NOT NULL,
  intent              JSONB       NOT NULL DEFAULT '{}',
  query_plan          JSONB       NOT NULL DEFAULT '{}',
  follow_up_questions JSONB       NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlquery_sessions_workspace
  ON nlquery_sessions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nlquery_sessions_intent_type
  ON nlquery_sessions ((intent->>'type'), workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nlquery_feedback (
  session_id  TEXT        NOT NULL PRIMARY KEY REFERENCES nlquery_sessions (session_id) ON DELETE CASCADE,
  helpful     BOOLEAN     NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlquery_feedback_workspace
  ON nlquery_feedback (created_at DESC);
