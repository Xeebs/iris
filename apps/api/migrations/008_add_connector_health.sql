-- Connector health history table.
-- Stores periodic health check results per connector instance.

CREATE TABLE IF NOT EXISTS connector_health (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  instance_id     TEXT        NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
  workspace_id    TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
  latency_ms      INTEGER,
  error_message   TEXT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_health_instance
  ON connector_health(instance_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_health_workspace
  ON connector_health(workspace_id, checked_at DESC);
