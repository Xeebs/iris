-- Tracks detailed performance metrics per connector sync job
CREATE TABLE IF NOT EXISTS sync_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  connector_instance_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  total_duration_ms INT,
  api_time_ms INT,
  indexing_time_ms INT,
  embedding_time_ms INT,
  api_calls INT NOT NULL DEFAULT 0,
  entities_synced INT NOT NULL DEFAULT 0,
  avg_entity_size_bytes INT,
  peak_memory_mb REAL,
  error_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_perf_connector
  ON sync_performance (connector_instance_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_perf_workspace
  ON sync_performance (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_perf_job
  ON sync_performance (job_id);
