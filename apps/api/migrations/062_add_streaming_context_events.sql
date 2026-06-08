-- Track every streaming context request for analytics and billing
CREATE TABLE IF NOT EXISTS streaming_context_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  query         TEXT NOT NULL,
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  entity_count  INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  truncated     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streaming_context_workspace
  ON streaming_context_events (workspace_id, created_at DESC);
