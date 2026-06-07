-- Tracks detailed sync lifecycle events for connector instances.
-- One row per event (started/succeeded/failed/warning) per sync run.

CREATE TABLE IF NOT EXISTS connector_sync_logs (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  instance_id   TEXT        NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
  workspace_id  TEXT        NOT NULL,
  sync_id       TEXT        NOT NULL,
  event_type    TEXT        NOT NULL CHECK (event_type IN ('started', 'completed', 'failed', 'warning', 'retry')),
  severity      TEXT        NOT NULL DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warn', 'error')),
  message       TEXT        NOT NULL,
  details       JSONB,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_instance_ts
  ON connector_sync_logs(instance_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_ts
  ON connector_sync_logs(workspace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_id
  ON connector_sync_logs(sync_id);
