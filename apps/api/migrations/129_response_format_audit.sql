-- Migration 129: Track response format usage for content negotiation analytics

CREATE TABLE IF NOT EXISTS response_format_audit (
  id          BIGSERIAL   PRIMARY KEY,
  endpoint    TEXT        NOT NULL,
  method      TEXT        NOT NULL DEFAULT 'GET',
  format      TEXT        NOT NULL DEFAULT 'json',  -- json | csv | parquet
  workspace_id TEXT       NOT NULL DEFAULT 'default',
  row_count   INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS response_format_audit_endpoint_format
  ON response_format_audit (endpoint, format, occurred_at DESC);

CREATE INDEX IF NOT EXISTS response_format_audit_workspace_occurred
  ON response_format_audit (workspace_id, occurred_at DESC);

COMMENT ON TABLE response_format_audit IS
  'Tracks which response formats (JSON/CSV/Parquet) are used per endpoint for analytics.';
