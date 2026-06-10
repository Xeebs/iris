-- ReliabilityPredictor (migration 149 added its score/alert tables) reads
-- per-sync outcomes from sync_outcomes and schema-change counts from
-- schema_evolution_log, but neither table was ever created — every
-- computeReliabilityScore call failed with 42P01.

CREATE TABLE IF NOT EXISTS sync_outcomes (
  id           BIGSERIAL PRIMARY KEY,
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  succeeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latency_ms   INTEGER NOT NULL DEFAULT 0,
  error_code   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_outcomes_connector
  ON sync_outcomes (connector_id, workspace_id, succeeded_at DESC);

CREATE TABLE IF NOT EXISTS schema_evolution_log (
  id           BIGSERIAL PRIMARY KEY,
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  change_type  TEXT NOT NULL DEFAULT 'unknown',
  details      JSONB NOT NULL DEFAULT '{}',
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_evolution_connector
  ON schema_evolution_log (connector_id, workspace_id, detected_at DESC);
