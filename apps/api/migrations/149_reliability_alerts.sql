-- Migration 149: Connector reliability scoring and alerts

CREATE TABLE IF NOT EXISTS reliability_scores (
  id              BIGSERIAL PRIMARY KEY,
  connector_id    TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  score           NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  success_rate    NUMERIC(5,4) NOT NULL DEFAULT 0,
  latency_p95_ms  INTEGER NOT NULL DEFAULT 0,
  error_rate      NUMERIC(5,4) NOT NULL DEFAULT 0,
  schema_stability NUMERIC(5,4) NOT NULL DEFAULT 1,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_ms       BIGINT NOT NULL DEFAULT 86400000
);

CREATE INDEX IF NOT EXISTS idx_rs_connector ON reliability_scores (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_rs_computed_at ON reliability_scores (computed_at DESC);

CREATE TABLE IF NOT EXISTS reliability_alerts (
  id              BIGSERIAL PRIMARY KEY,
  connector_id    TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  alert_type      TEXT NOT NULL CHECK (alert_type IN ('warning', 'critical', 'anomaly', 'forecast')),
  reason          TEXT NOT NULL,
  score_at_alert  NUMERIC(5,2),
  suppressed      BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ra_connector ON reliability_alerts (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_ra_created_at ON reliability_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ra_suppressed ON reliability_alerts (suppressed, acknowledged);

CREATE TABLE IF NOT EXISTS alert_suppressions (
  id              BIGSERIAL PRIMARY KEY,
  connector_id    TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  alert_type      TEXT NOT NULL,
  suppressed_by   TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, workspace_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_as_connector ON alert_suppressions (connector_id, workspace_id);
