-- LLM cost estimation tracking and provider accuracy baselines

CREATE TABLE IF NOT EXISTS llm_cost_estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  query_hash      TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'azure', 'gemini')),
  actual_tokens   INTEGER NOT NULL CHECK (actual_tokens >= 0),
  cost_cents      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  user_satisfaction_score NUMERIC(3, 2) CHECK (user_satisfaction_score BETWEEN 0 AND 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_cost_estimates_workspace_provider
  ON llm_cost_estimates (workspace_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_cost_estimates_query_hash
  ON llm_cost_estimates (workspace_id, query_hash);

-- Provider accuracy baselines (materialized snapshots updated periodically)
CREATE TABLE IF NOT EXISTS provider_accuracy_baseline (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'azure', 'gemini')),
  complexity_min    INTEGER NOT NULL DEFAULT 1,
  complexity_max    INTEGER NOT NULL DEFAULT 10,
  accuracy_score    NUMERIC(4, 3) NOT NULL CHECK (accuracy_score BETWEEN 0 AND 1),
  sample_count      INTEGER NOT NULL DEFAULT 0,
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, complexity_min, complexity_max)
);

CREATE INDEX IF NOT EXISTS idx_provider_accuracy_baseline_workspace
  ON provider_accuracy_baseline (workspace_id, provider);
