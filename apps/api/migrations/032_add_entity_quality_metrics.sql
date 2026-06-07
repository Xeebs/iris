CREATE TABLE IF NOT EXISTS entity_quality_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  connector_instance_id TEXT,
  entity_type TEXT NOT NULL,
  completeness_score REAL NOT NULL DEFAULT 0,
  freshness_score REAL NOT NULL DEFAULT 0,
  conformance_score REAL NOT NULL DEFAULT 0,
  relationship_score REAL NOT NULL DEFAULT 0,
  overall_quality_score REAL NOT NULL DEFAULT 0,
  issues JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_quality_workspace ON entity_quality_metrics (workspace_id);
CREATE INDEX IF NOT EXISTS idx_entity_quality_score ON entity_quality_metrics (workspace_id, overall_quality_score);
CREATE INDEX IF NOT EXISTS idx_entity_quality_type ON entity_quality_metrics (workspace_id, entity_type);
