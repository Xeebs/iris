-- Migration: Add index composition snapshots for trend analytics

CREATE TABLE IF NOT EXISTS index_composition_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                TEXT NOT NULL,
  snapshot_date               DATE NOT NULL,
  entity_types_json           JSONB NOT NULL DEFAULT '[]',
  connector_contributions_json JSONB NOT NULL DEFAULT '[]',
  freshness_metrics_json      JSONB NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_composition_snapshot_per_day UNIQUE (workspace_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_composition_snapshots_workspace
  ON index_composition_snapshots (workspace_id, snapshot_date DESC);
