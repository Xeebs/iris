-- CDC metrics for incremental sync tracking
CREATE TABLE IF NOT EXISTS connector_cdc_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_instance_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('cursor', 'event_driven', 'snapshot_diff')),
  last_cursor TEXT,
  last_snapshot_hash TEXT,
  entities_changed INT NOT NULL DEFAULT 0,
  entities_unchanged INT NOT NULL DEFAULT 0,
  sync_efficiency_ratio REAL,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cdc_state_workspace ON connector_cdc_state (workspace_id);
CREATE INDEX IF NOT EXISTS idx_cdc_state_instance ON connector_cdc_state (connector_instance_id);
