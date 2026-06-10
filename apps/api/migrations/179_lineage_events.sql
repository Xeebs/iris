-- MetricsAnomalyDetector correlates metric anomalies with recent lineage
-- events (getAnomalyContext), but lineage_events was never created — the
-- call failed with 42P01.

CREATE TABLE IF NOT EXISTS lineage_events (
  id          BIGSERIAL PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lineage_events_occurred
  ON lineage_events (occurred_at DESC);
