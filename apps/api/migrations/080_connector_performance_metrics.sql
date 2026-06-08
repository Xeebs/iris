-- Migration 080: Connector sync performance metrics tracking

CREATE TABLE IF NOT EXISTS connector_sync_metrics (
  id             BIGSERIAL    PRIMARY KEY,
  connector_id   TEXT         NOT NULL,
  workspace_id   UUID         NOT NULL,
  sync_run_id    TEXT         NOT NULL,
  metric_name    TEXT         NOT NULL
    CHECK (metric_name IN (
      'batch_size', 'concurrency', 'pagination_type',
      'total_records', 'duration_ms', 'throughput_records_per_sec',
      'error_rate', 'avg_record_bytes'
    )),
  value          NUMERIC(20, 6) NOT NULL,
  value_text     TEXT,
  recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_metrics_connector_run
  ON connector_sync_metrics(connector_id, sync_run_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_metrics_workspace
  ON connector_sync_metrics(workspace_id, connector_id, metric_name, recorded_at DESC);
