-- Migration 148: Data freshness tracking tables

CREATE TABLE IF NOT EXISTS entity_freshness_tracking (
  id            BIGSERIAL PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  connector_id  TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  last_modified TIMESTAMPTZ NOT NULL,
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eft_entity ON entity_freshness_tracking (entity_id);
CREATE INDEX IF NOT EXISTS idx_eft_connector_workspace ON entity_freshness_tracking (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_eft_entity_type ON entity_freshness_tracking (entity_type, workspace_id);
CREATE INDEX IF NOT EXISTS idx_eft_last_modified ON entity_freshness_tracking (last_modified);

CREATE TABLE IF NOT EXISTS freshness_events (
  id            BIGSERIAL PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  connector_id  TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('sync', 'stale_warning', 'sla_breach')),
  age_seconds   BIGINT NOT NULL,
  sla_seconds   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fe_entity ON freshness_events (entity_id);
CREATE INDEX IF NOT EXISTS idx_fe_connector ON freshness_events (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_fe_created_at ON freshness_events (created_at);

CREATE TABLE IF NOT EXISTS freshness_slas (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  connector_id  TEXT,
  entity_type   TEXT,
  max_age_seconds BIGINT NOT NULL,
  warning_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 80.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_fs_workspace ON freshness_slas (workspace_id);
