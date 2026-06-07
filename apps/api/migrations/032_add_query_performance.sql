-- Per-request query performance metrics
CREATE TABLE IF NOT EXISTS query_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  query_text TEXT,
  execution_time_ms INT NOT NULL DEFAULT 0,
  embedding_time_ms INT,
  vector_search_time_ms INT,
  graph_expansion_time_ms INT,
  compression_time_ms INT,
  result_size INT,
  metrics_json JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qperf_workspace_ts ON query_performance (workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_qperf_hash ON query_performance (workspace_id, query_hash, timestamp DESC);
