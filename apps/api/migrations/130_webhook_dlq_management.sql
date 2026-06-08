-- Migration 130: Webhook DLQ and retry log for delivery reliability

CREATE TABLE IF NOT EXISTS webhook_retry_log (
  id              BIGSERIAL   PRIMARY KEY,
  webhook_id      TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  attempt_number  INTEGER     NOT NULL,
  http_status     INTEGER,
  error_message   TEXT,
  duration_ms     INTEGER,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_retry_log_webhook ON webhook_retry_log (webhook_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS webhook_dlq (
  id              TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  endpoint        TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  final_error     TEXT        NOT NULL,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at     TIMESTAMPTZ,
  replayed_by     TEXT
);

CREATE INDEX IF NOT EXISTS webhook_dlq_workspace_failed
  ON webhook_dlq (workspace_id, failed_at DESC);

CREATE INDEX IF NOT EXISTS webhook_dlq_replayed
  ON webhook_dlq (workspace_id, replayed_at)
  WHERE replayed_at IS NULL;

COMMENT ON TABLE webhook_retry_log IS 'Per-attempt delivery log for webhook retry tracking.';
COMMENT ON TABLE webhook_dlq IS 'Dead-letter queue for webhooks that exhausted all retry attempts.';
