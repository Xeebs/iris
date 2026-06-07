-- Webhook delivery event tracking table.
-- Stores each outbound webhook attempt and its delivery status.

CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_id      TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  target_url      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
  attempt_count   INT         NOT NULL DEFAULT 0,
  http_status     INT,
  error_message   TEXT,
  next_retry_at   TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace_status
  ON webhook_events(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_webhook_id
  ON webhook_events(webhook_id);
