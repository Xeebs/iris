CREATE TABLE IF NOT EXISTS performance_samples (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL,
  connector_id TEXT,
  workspace_id TEXT,
  duration_ms REAL NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_samples_operation ON performance_samples (operation, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_samples_workspace ON performance_samples (workspace_id, recorded_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perf_samples_connector ON performance_samples (connector_id, recorded_at DESC) WHERE connector_id IS NOT NULL;
