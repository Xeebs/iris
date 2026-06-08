CREATE TABLE IF NOT EXISTS compliance_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN ('access', 'export', 'delete', 'modify', 'share')),
  entity_id        TEXT,
  accessed_fields  TEXT[] NOT NULL DEFAULT '{}',
  user_id          TEXT NOT NULL,
  tool_name        TEXT,
  ip_address       TEXT,
  device_info      JSONB,
  metadata         JSONB,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_events_workspace_time
  ON compliance_events (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_events_user
  ON compliance_events (workspace_id, user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_events_entity
  ON compliance_events (workspace_id, entity_id) WHERE entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  alert_type       TEXT NOT NULL CHECK (alert_type IN ('unusual_time', 'bulk_export', 'new_location', 'high_volume', 'pii_access')),
  severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  user_id          TEXT NOT NULL,
  description      TEXT NOT NULL,
  event_ids        UUID[] NOT NULL DEFAULT '{}',
  acknowledged     BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by  TEXT,
  acknowledged_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_workspace
  ON anomaly_alerts (workspace_id, acknowledged, created_at DESC);

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  request_type     TEXT NOT NULL CHECK (request_type IN ('access', 'deletion', 'portability', 'correction')),
  subject_email    TEXT NOT NULL,
  submitted_by     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  entity_ids       TEXT[] NOT NULL DEFAULT '{}',
  completed_at     TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_workspace
  ON data_subject_requests (workspace_id, status, created_at DESC);
