-- Migration 110: query cost estimation and analysis tables

CREATE TABLE IF NOT EXISTS query_cost_estimates (
  query_hash                TEXT          NOT NULL,
  provider                  TEXT          NOT NULL,
  estimated_delta_tokens    INTEGER       NOT NULL DEFAULT 0,
  estimated_context_tokens  INTEGER       NOT NULL DEFAULT 0,
  total_estimated_cost_cents NUMERIC(10,4) NOT NULL DEFAULT 0,
  optimization_suggestions  JSONB         NOT NULL DEFAULT '[]'::jsonb,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_hash, provider)
);

CREATE TABLE IF NOT EXISTS cost_model_features (
  id                  TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  query_type          TEXT          NOT NULL CHECK (query_type IN ('analytical', 'operational', 'reporting', 'synthesis')),
  entity_count_range  TEXT          NOT NULL,
  relationship_depth  INTEGER       NOT NULL DEFAULT 0,
  model_accuracy_pct  NUMERIC(5,2)  NOT NULL DEFAULT 80,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_estimates_created ON query_cost_estimates (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_model_features_type ON cost_model_features (query_type);
