-- Migration 151: Sync parallelism optimization configs, experiments, results

CREATE TABLE IF NOT EXISTS sync_optimization_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id     TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  entity_type      TEXT NOT NULL DEFAULT '*',
  concurrency      INTEGER NOT NULL DEFAULT 5 CHECK (concurrency BETWEEN 1 AND 50),
  batch_size       INTEGER NOT NULL DEFAULT 100 CHECK (batch_size BETWEEN 1 AND 5000),
  worker_weight    NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (worker_weight BETWEEN 0 AND 10),
  auto_tune        BOOLEAN NOT NULL DEFAULT TRUE,
  last_tuned_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, workspace_id, entity_type)
);

CREATE TABLE IF NOT EXISTS optimization_experiments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id     TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  variant_name     TEXT NOT NULL,
  concurrency      INTEGER NOT NULL,
  batch_size       INTEGER NOT NULL,
  traffic_pct      NUMERIC(5,2) NOT NULL DEFAULT 10.0 CHECK (traffic_pct BETWEEN 0 AND 100),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','aborted')),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id        UUID NOT NULL REFERENCES optimization_experiments(id) ON DELETE CASCADE,
  connector_id         TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  throughput_per_sec   NUMERIC(10,4),
  p50_latency_ms       NUMERIC(10,2),
  p95_latency_ms       NUMERIC(10,2),
  error_rate           NUMERIC(7,6),
  entities_synced      INTEGER,
  duration_ms          INTEGER,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_opt_configs_connector
  ON sync_optimization_configs (connector_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_opt_experiments_connector
  ON optimization_experiments (connector_id, workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_experiment_results_exp
  ON experiment_results (experiment_id, recorded_at DESC);
