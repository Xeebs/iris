-- Rule-based entity deduplication: workspace-scoped rules stored as structured JSON conditions
CREATE TABLE IF NOT EXISTS entity_dedup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  condition_json JSONB NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  created_by TEXT,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_dedup_rules_workspace_type
  ON entity_dedup_rules (workspace_id, entity_type)
  WHERE disabled_at IS NULL;
