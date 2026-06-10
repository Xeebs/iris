-- MetricsAnomalyDetector (migration 080 added metric_anomalies) reads the
-- raw time series from metric_values, which was never created — every
-- detection call failed with 42P01.

CREATE TABLE IF NOT EXISTS metric_values (
  id          BIGSERIAL PRIMARY KEY,
  metric_id   TEXT NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metric_values_series
  ON metric_values (metric_id, recorded_at);
