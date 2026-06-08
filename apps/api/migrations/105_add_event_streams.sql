-- Event-driven real-time sync: streams, delivery queue, audit log

CREATE TABLE IF NOT EXISTS connector_event_streams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  event_types  TEXT[] NOT NULL DEFAULT '{}',
  config_json  JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_event_streams_workspace
  ON connector_event_streams (workspace_id, enabled);

CREATE TABLE IF NOT EXISTS event_delivery_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  connector_id  TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  change_type   TEXT NOT NULL CHECK (change_type IN ('entity_created', 'entity_updated', 'entity_deleted', 'relationship_changed')),
  payload_json  JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_delivery_queue_workspace_status
  ON event_delivery_queue (workspace_id, status, next_retry_at ASC NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_event_delivery_queue_connector
  ON event_delivery_queue (workspace_id, connector_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS event_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  connector_id    TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  change_summary  TEXT NOT NULL,
  delivered_at    TIMESTAMPTZ,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_audit_log_workspace
  ON event_audit_log (workspace_id, delivered_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_event_audit_log_connector
  ON event_audit_log (workspace_id, connector_id, delivered_at DESC NULLS LAST);
