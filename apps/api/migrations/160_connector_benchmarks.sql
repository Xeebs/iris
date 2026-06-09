-- Migration 160: Connector performance benchmarking tables

CREATE TABLE IF NOT EXISTS connector_benchmarks (
  benchmark_id        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  connector_id        TEXT        NOT NULL,
  entity_type         TEXT        NOT NULL,
  data_size           INTEGER     NOT NULL,
  duration_ms         INTEGER     NOT NULL,
  throughput_per_sec  FLOAT       NOT NULL DEFAULT 0,
  memory_peak_mb      FLOAT       NOT NULL DEFAULT 0,
  api_call_count      INTEGER     NOT NULL DEFAULT 0,
  error_rate          FLOAT       NOT NULL DEFAULT 0,
  avg_transform_ms    FLOAT       NOT NULL DEFAULT 0,
  run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cb_connector_entity ON connector_benchmarks (connector_id, entity_type, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_cb_run_at ON connector_benchmarks (run_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_baselines (
  baseline_id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  connector_id          TEXT        NOT NULL,
  entity_type           TEXT        NOT NULL,
  baseline_throughput   FLOAT       NOT NULL,
  baseline_memory_mb    FLOAT       NOT NULL,
  measured_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_bb_connector_entity ON benchmark_baselines (connector_id, entity_type);
