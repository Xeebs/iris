-- Migration 124: High-availability region config, replication status, and failover log

CREATE TABLE IF NOT EXISTS region_config (
  workspace_id                  TEXT          NOT NULL,
  region_id                     TEXT          NOT NULL,
  role                          TEXT          NOT NULL DEFAULT 'replica',  -- primary | replica
  postgres_url                  TEXT          NOT NULL,
  replication_lag_threshold_ms  INTEGER       NOT NULL DEFAULT 5000,
  health_check_interval_ms      INTEGER       NOT NULL DEFAULT 30000,
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, region_id)
);

CREATE TABLE IF NOT EXISTS replication_status (
  workspace_id        TEXT          NOT NULL,
  region_id           TEXT          NOT NULL,
  primary_region_id   TEXT          NOT NULL,
  lag_ms              INTEGER,                -- null when lag is unknown
  last_sync_at        TIMESTAMPTZ,
  status              TEXT          NOT NULL DEFAULT 'healthy',  -- healthy | degraded | unreachable
  checked_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, region_id)
);

CREATE TABLE IF NOT EXISTS ha_failover_log (
  id                  TEXT          PRIMARY KEY,
  workspace_id        TEXT          NOT NULL,
  from_region         TEXT          NOT NULL,
  to_region           TEXT          NOT NULL,
  reason              TEXT          NOT NULL,  -- manual | health_check_failure | replication_lag_exceeded
  lag_at_failover_ms  INTEGER,
  duration_ms         INTEGER,                 -- how long the failover took
  initiated_by        TEXT          NOT NULL DEFAULT 'system',
  occurred_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ha_failover_log_workspace_occurred
  ON ha_failover_log (workspace_id, occurred_at DESC);

COMMENT ON TABLE region_config IS 'Per-workspace region topology for HA multi-region deployments.';
COMMENT ON TABLE replication_status IS 'Latest replication health and lag per replica region.';
COMMENT ON TABLE ha_failover_log IS 'Audit log of all failover events including reason and duration.';
