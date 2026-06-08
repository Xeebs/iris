-- Cost optimization recommendations: tracks advisor suggestions and whether they've been applied
CREATE TABLE IF NOT EXISTS cost_optimization_recommendations (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id            TEXT        NOT NULL,
  recommendation_id       TEXT        NOT NULL,
  type                    TEXT        NOT NULL,
  estimated_savings_cents NUMERIC(10,2) NOT NULL DEFAULT 0,
  applied_at              TIMESTAMPTZ,
  savings_realized_cents  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workspace_recommendation UNIQUE (workspace_id, recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_cost_recs_workspace
  ON cost_optimization_recommendations (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_recs_applied
  ON cost_optimization_recommendations (workspace_id, applied_at)
  WHERE applied_at IS NOT NULL;
