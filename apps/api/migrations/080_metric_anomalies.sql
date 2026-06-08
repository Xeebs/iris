-- Migration 080_metric_anomalies: Metric Anomaly Records
-- Stores detected metric anomalies for dashboard surfacing and investigation.

CREATE TABLE IF NOT EXISTS metric_anomalies (
  anomaly_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id       TEXT        NOT NULL,
  anomaly_date    TIMESTAMPTZ NOT NULL,
  observed_value  DOUBLE PRECISION NOT NULL,
  expected_value  DOUBLE PRECISION NOT NULL,
  z_score         DOUBLE PRECISION NOT NULL,
  severity        TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  notes           TEXT,

  CONSTRAINT uq_metric_anomaly UNIQUE (metric_id, anomaly_date)
);

CREATE INDEX IF NOT EXISTS idx_metric_anomalies_metric
  ON metric_anomalies (metric_id, anomaly_date DESC);

CREATE INDEX IF NOT EXISTS idx_metric_anomalies_unacked
  ON metric_anomalies (metric_id, acknowledged_at)
  WHERE acknowledged_at IS NULL;
