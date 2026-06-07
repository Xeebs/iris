-- Alert rules, channels, and event log for workspace notifications
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  condition TEXT NOT NULL
    CHECK (condition IN ('sync_failure', 'token_quota', 'performance_degradation', 'cache_miss_rate')),
  threshold REAL NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'slack', 'pagerduty', 'webhook')),
  config JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES alert_channels(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'triggered'
    CHECK (status IN ('triggered', 'delivered', 'failed')),
  payload JSONB,
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace ON alert_rules (workspace_id);
CREATE INDEX IF NOT EXISTS idx_alert_channels_workspace ON alert_channels (workspace_id);
CREATE INDEX IF NOT EXISTS idx_alert_events_workspace ON alert_events (workspace_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events (rule_id, sent_at DESC);
