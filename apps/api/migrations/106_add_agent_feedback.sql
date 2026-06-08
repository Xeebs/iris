-- Agent context feedback and relevance learning

CREATE TABLE IF NOT EXISTS agent_context_usage (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_id             TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  query_hash           TEXT NOT NULL,
  context_ids          TEXT[] NOT NULL DEFAULT '{}',
  context_budget_used  INTEGER NOT NULL DEFAULT 0,
  served_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usage_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_context_usage_workspace_agent
  ON agent_context_usage (workspace_id, agent_id, served_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_context_usage_query
  ON agent_context_usage (workspace_id, query_hash, served_at DESC);

CREATE TABLE IF NOT EXISTS agent_feedback (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id            TEXT NOT NULL,
  usage_id               TEXT NOT NULL REFERENCES agent_context_usage (usage_id) ON DELETE CASCADE,
  rating                 SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment                TEXT,
  corrected_context_json JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feedback_source        TEXT NOT NULL CHECK (feedback_source IN ('explicit', 'implicit', 'inferred')),
  UNIQUE (feedback_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_usage
  ON agent_feedback (usage_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_rating
  ON agent_feedback (feedback_source, rating, created_at DESC);

CREATE TABLE IF NOT EXISTS relevance_adjustments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type             TEXT NOT NULL,
  workspace_id            TEXT NOT NULL,
  positive_feedback_count INTEGER NOT NULL DEFAULT 0,
  negative_feedback_count INTEGER NOT NULL DEFAULT 0,
  weight_adjustment       NUMERIC(5, 4) NOT NULL DEFAULT 0 CHECK (weight_adjustment BETWEEN -1 AND 1),
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_relevance_adjustments_workspace
  ON relevance_adjustments (workspace_id, weight_adjustment DESC);
