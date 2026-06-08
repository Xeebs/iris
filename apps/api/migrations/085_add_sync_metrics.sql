-- Tracks per-batch metrics for every connector sync run
CREATE TABLE IF NOT EXISTS sync_metrics (
  metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  batch_size INTEGER NOT NULL,
  entity_count INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  entity_throughput DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN duration_ms > 0 THEN entity_count::double precision / (duration_ms::double precision / 1000.0) ELSE 0 END
  ) STORED,
  token_throughput DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN duration_ms > 0 THEN token_count::double precision / (duration_ms::double precision / 1000.0) ELSE 0 END
  ) STORED,
  api_calls INTEGER NOT NULL DEFAULT 0,
  rate_limited BOOLEAN NOT NULL DEFAULT false,
  error_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_metrics_connector ON sync_metrics (connector_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_metrics_workspace ON sync_metrics (workspace_id, recorded_at DESC);

-- Stores optimization recommendations per connector
CREATE TABLE IF NOT EXISTS sync_optimization_recommendations (
  recommendation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  recommended_batch_size INTEGER NOT NULL,
  recommended_parallelism INTEGER NOT NULL,
  bottleneck TEXT NOT NULL CHECK (bottleneck IN ('api_rate_limit', 'processing_time', 'memory', 'unknown')),
  estimated_throughput_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  CONSTRAINT uq_optimization_connector UNIQUE (connector_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_optimization_connector ON sync_optimization_recommendations (connector_id, workspace_id);
