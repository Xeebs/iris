-- Cross-connector canonical entity links
CREATE TABLE IF NOT EXISTS entity_cross_connector_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  entity_id_a TEXT NOT NULL,
  connector_a TEXT NOT NULL,
  entity_id_b TEXT NOT NULL,
  connector_b TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  match_signals JSONB,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_id_a, entity_id_b)
);

CREATE INDEX IF NOT EXISTS idx_eccl_workspace ON entity_cross_connector_links (workspace_id);
CREATE INDEX IF NOT EXISTS idx_eccl_entity_a ON entity_cross_connector_links (entity_id_a);
CREATE INDEX IF NOT EXISTS idx_eccl_entity_b ON entity_cross_connector_links (entity_id_b);
