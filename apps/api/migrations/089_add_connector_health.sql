-- Connector health scoring, alerting, and recovery tracking.

CREATE TABLE IF NOT EXISTS connector_health_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id      TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  overall_score     INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  sync_success_rate FLOAT NOT NULL,
  entity_freshness  FLOAT NOT NULL,
  error_frequency   FLOAT NOT NULL,
  auth_validity     FLOAT NOT NULL,
  scored_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connector_health_scores_lookup_idx
  ON connector_health_scores (connector_id, workspace_id, scored_at DESC);

CREATE TABLE IF NOT EXISTS health_alerts (
  alert_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id   TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  alert_type     TEXT NOT NULL CHECK (alert_type IN ('degradation','auth_expiry','sync_failure','stale_data')),
  severity       TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  message        TEXT NOT NULL,
  current_score  INTEGER,
  baseline_score INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS health_alerts_workspace_idx ON health_alerts (workspace_id, resolved_at);
CREATE INDEX IF NOT EXISTS health_alerts_connector_idx ON health_alerts (connector_id, workspace_id, resolved_at);

CREATE TABLE IF NOT EXISTS recovery_actions (
  action_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  action_type   TEXT NOT NULL CHECK (action_type IN ('re-auth','manual-sync','pause','retry')),
  reason        TEXT NOT NULL,
  executed_at   TIMESTAMPTZ,
  result        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_actions_connector_idx ON recovery_actions (connector_id, workspace_id, executed_at DESC);
