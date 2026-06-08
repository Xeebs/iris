-- Migration 112: context budget monitoring and alerting

CREATE TABLE IF NOT EXISTS workspace_budgets (
  workspace_id           TEXT         PRIMARY KEY,
  monthly_token_budget   INTEGER      NOT NULL DEFAULT 1000000,
  rolling_window_days    INTEGER      NOT NULL DEFAULT 30,
  alert_thresholds       JSONB        NOT NULL DEFAULT '[75, 90, 100]'::jsonb,
  auto_limit_mode        BOOLEAN      NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_usage_events (
  workspace_id     TEXT         NOT NULL,
  query_id         TEXT         NOT NULL,
  tokens_consumed  INTEGER      NOT NULL DEFAULT 0,
  context_size     INTEGER      NOT NULL DEFAULT 0,
  provider         TEXT         NOT NULL,
  timestamp        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, query_id)
);

CREATE TABLE IF NOT EXISTS budget_alerts (
  id                           TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id                 TEXT         NOT NULL,
  threshold_pct                INTEGER      NOT NULL,
  triggered_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  acknowledged_at              TIMESTAMPTZ,
  notification_channels_used   JSONB        NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_budget_events_workspace_time ON budget_usage_events (workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_workspace ON budget_alerts (workspace_id, acknowledged_at);
