-- Migration 144: Multi-Stage Query Expansion & Iterative Context Refinement
-- Stores expansion sessions, user feedback, and suggested expansion directions.

CREATE TABLE IF NOT EXISTS query_expansion_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query           TEXT NOT NULL,
  stage           INT NOT NULL DEFAULT 1,
  results_json    JSONB NOT NULL DEFAULT '[]',
  directions_json JSONB NOT NULL DEFAULT '[]',
  feedback_json   JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS query_expansion_sessions_created_at_idx ON query_expansion_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS query_expansion_sessions_query_idx ON query_expansion_sessions USING gin (to_tsvector('english', query));

CREATE TABLE IF NOT EXISTS expansion_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES query_expansion_sessions(id) ON DELETE CASCADE,
  feedback_json JSONB NOT NULL DEFAULT '[]',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expansion_feedback_session_idx ON expansion_feedback (session_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS expansion_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query           TEXT NOT NULL,
  axis            TEXT NOT NULL,
  value           TEXT NOT NULL,
  relevance_score NUMERIC(5, 4) NOT NULL,
  applied_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expansion_suggestions_query_idx ON expansion_suggestions (query, relevance_score DESC);
