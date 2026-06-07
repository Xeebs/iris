CREATE TABLE IF NOT EXISTS index_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'ready', 'failed', 'restoring', 'deleted')),
  entity_count INT,
  snapshot_size_bytes BIGINT,
  storage_path TEXT,
  error_message TEXT,
  retention_days INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ GENERATED ALWAYS AS (created_at + (retention_days || ' days')::INTERVAL) STORED
);

CREATE INDEX IF NOT EXISTS idx_snapshots_workspace ON index_snapshots (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_expires ON index_snapshots (expires_at) WHERE status = 'ready';
