-- Token usage events for analytics and savings tracking.
-- One row per MCP tool invocation; aggregated by the analytics service.

CREATE TABLE IF NOT EXISTS token_events (
  id                          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id                TEXT        NOT NULL,
  tokens_spent                INT         NOT NULL DEFAULT 0,
  tokens_saved_caching        INT         NOT NULL DEFAULT 0,
  tokens_saved_compression    INT         NOT NULL DEFAULT 0,
  tool_name                   TEXT,
  cache_hit                   BOOLEAN     NOT NULL DEFAULT FALSE,
  timestamp                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_events_workspace_ts
  ON token_events(workspace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_events_workspace_date
  ON token_events(workspace_id, DATE(timestamp));
