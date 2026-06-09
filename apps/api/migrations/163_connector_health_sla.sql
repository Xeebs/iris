-- Migration 163: Connector health scores, SLA targets, and health incidents

CREATE TABLE IF NOT EXISTS connector_health_scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  overall_score INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  sync_success_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  entity_freshness DOUBLE PRECISION NOT NULL DEFAULT 0,
  error_frequency DOUBLE PRECISION NOT NULL DEFAULT 0,
  auth_validity DOUBLE PRECISION NOT NULL DEFAULT 0,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_scores_connector ON connector_health_scores (connector_id, workspace_id, scored_at DESC);

CREATE TABLE IF NOT EXISTS sla_targets (
  target_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  min_health_score INTEGER NOT NULL DEFAULT 70 CHECK (min_health_score BETWEEN 0 AND 100),
  min_sync_success_rate DOUBLE PRECISION NOT NULL DEFAULT 0.95,
  max_sync_latency_seconds INTEGER NOT NULL DEFAULT 300,
  uptime_target_pct DOUBLE PRECISION NOT NULL DEFAULT 99.5,
  measurement_window_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS sla_breaches (
  breach_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_id UUID REFERENCES sla_targets (target_id) ON DELETE SET NULL,
  breach_type TEXT NOT NULL CHECK (breach_type IN ('health_score','sync_success_rate','latency','uptime')),
  actual_value DOUBLE PRECISION NOT NULL,
  target_value DOUBLE PRECISION NOT NULL,
  breach_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  breach_resolved_at TIMESTAMPTZ,
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_sla_breaches_connector ON sla_breaches (connector_id, workspace_id, breach_started_at DESC);

CREATE TABLE IF NOT EXISTS health_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('degradation','auth_expiry','sync_failure','stale_data')),
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  message TEXT NOT NULL,
  current_score INTEGER,
  baseline_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_health_alerts_workspace ON health_alerts (workspace_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_health_alerts_connector ON health_alerts (connector_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recovery_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('re-auth','manual-sync','pause','retry')),
  reason TEXT NOT NULL,
  executed_at TIMESTAMPTZ,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
