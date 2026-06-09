-- Migration 109: connector health monitoring tables
-- health_alerts may already exist from 089_add_connector_health.sql without acknowledged_at.
ALTER TABLE health_alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS connector_health_scores (
  connector_id   TEXT        NOT NULL,
  workspace_id   TEXT        NOT NULL,
  score          INTEGER     NOT NULL DEFAULT 100 CHECK (score BETWEEN 0 AND 100),
  last_sync_success_rate NUMERIC(5,2) NOT NULL DEFAULT 100,
  last_sync_latency_ms   INTEGER NOT NULL DEFAULT 0,
  last_error_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_throttle_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connector_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS health_alerts (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  connector_id   TEXT        NOT NULL,
  workspace_id   TEXT        NOT NULL,
  severity       TEXT        NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  failure_type   TEXT        NOT NULL,
  suggested_action TEXT      NOT NULL,
  acknowledged_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_alerts_connector ON health_alerts (connector_id, workspace_id, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_health_scores_workspace ON connector_health_scores (workspace_id);
