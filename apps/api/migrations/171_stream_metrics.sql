-- Migration 171: streaming_sessions and stream_errors

CREATE TABLE IF NOT EXISTS streaming_sessions (
  stream_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  query_id        TEXT,
  entity_filters  TEXT[],
  context_budget  INTEGER NOT NULL DEFAULT 2000,
  total_chunks    INTEGER NOT NULL DEFAULT 0,
  total_bytes     INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  latency_p95_ms  INTEGER,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'completed', 'aborted', 'error')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_streaming_sessions_workspace
  ON streaming_sessions (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_streaming_sessions_query
  ON streaming_sessions (query_id) WHERE query_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stream_errors (
  error_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id     UUID NOT NULL REFERENCES streaming_sessions (stream_id) ON DELETE CASCADE,
  error_type    TEXT NOT NULL,
  error_message TEXT NOT NULL,
  chunk_index   INTEGER,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_errors_session
  ON stream_errors (stream_id, occurred_at);
