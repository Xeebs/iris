CREATE TABLE IF NOT EXISTS connector_resilience_config (
  connector_id TEXT PRIMARY KEY,
  max_retries INT NOT NULL DEFAULT 3,
  backoff_strategy TEXT NOT NULL DEFAULT 'exponential'
    CHECK (backoff_strategy IN ('exponential', 'linear', 'fibonacci')),
  base_delay_ms INT NOT NULL DEFAULT 1000,
  max_delay_ms INT NOT NULL DEFAULT 60000,
  jitter_factor REAL NOT NULL DEFAULT 0.2,
  circuit_breaker_threshold REAL NOT NULL DEFAULT 0.5,
  circuit_cooldown_ms INT NOT NULL DEFAULT 30000,
  timeout_ms INT NOT NULL DEFAULT 10000,
  max_concurrent INT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_resilience_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  timeout_count INT NOT NULL DEFAULT 0,
  circuit_breaker_trips INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  circuit_state TEXT NOT NULL DEFAULT 'closed'
    CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resilience_metrics_connector ON connector_resilience_metrics (connector_id, recorded_at DESC);
