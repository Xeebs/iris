-- Stores per-workspace LLM provider configuration with encrypted credentials
CREATE TABLE IF NOT EXISTS llm_provider_configs (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('openai', 'anthropic', 'google', 'ollama')),
  model_id TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  cost_per_1m_tokens DOUBLE PRECISION NOT NULL DEFAULT 0,
  default_for_use_case TEXT CHECK (default_for_use_case IN ('completion', 'embedding')),
  endpoint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_provider UNIQUE (workspace_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_workspace ON llm_provider_configs (workspace_id);
