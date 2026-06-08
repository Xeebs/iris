-- Migration 133: metric events and analytics aggregates
-- Stores raw metric events and pre-rolled daily/hourly aggregates

CREATE TABLE IF NOT EXISTS metric_events (
  id           UUID NOT NULL DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  dimensions   JSONB NOT NULL DEFAULT '{}',
  workspace_id UUID NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Default partition for current and recent data
CREATE TABLE IF NOT EXISTS metric_events_default PARTITION OF metric_events DEFAULT;

CREATE TABLE IF NOT EXISTS metric_aggregates_hourly (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  workspace_id  UUID NOT NULL,
  bucket_ts     TIMESTAMPTZ NOT NULL,
  p50           DOUBLE PRECISION NOT NULL,
  p95           DOUBLE PRECISION NOT NULL,
  p99           DOUBLE PRECISION NOT NULL,
  mean          DOUBLE PRECISION NOT NULL,
  stddev        DOUBLE PRECISION NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  aggregated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, workspace_id, bucket_ts)
);

CREATE TABLE IF NOT EXISTS metric_aggregates_daily (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  workspace_id  UUID NOT NULL,
  bucket_ts     TIMESTAMPTZ,
  p50           DOUBLE PRECISION NOT NULL,
  p95           DOUBLE PRECISION NOT NULL,
  p99           DOUBLE PRECISION NOT NULL,
  mean          DOUBLE PRECISION NOT NULL,
  stddev        DOUBLE PRECISION NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  aggregated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, workspace_id, aggregated_at)
);

CREATE INDEX IF NOT EXISTS idx_metric_events_name_ts ON metric_events(name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metric_events_workspace_ts ON metric_events(workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metric_aggregates_hourly_name ON metric_aggregates_hourly(name, workspace_id, bucket_ts DESC);
CREATE INDEX IF NOT EXISTS idx_metric_aggregates_daily_name ON metric_aggregates_daily(name, workspace_id, aggregated_at DESC);
