-- Migration 142: Batch Context Recommendations & Multi-Entity Analysis
-- Stores batch analysis sessions and group-level recommendation results.

CREATE TABLE IF NOT EXISTS batch_analysis_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_ids   JSONB NOT NULL,
  result_json  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS batch_analysis_cache_created_at_idx ON batch_analysis_cache (created_at DESC);
CREATE INDEX IF NOT EXISTS batch_analysis_cache_expires_at_idx ON batch_analysis_cache (expires_at);

CREATE TABLE IF NOT EXISTS group_recommendations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   TEXT NOT NULL,
  metric      TEXT NOT NULL,
  score       NUMERIC(6, 4) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS group_recommendations_entity_metric_idx ON group_recommendations (entity_id, metric, recorded_at DESC);
