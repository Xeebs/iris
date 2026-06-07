CREATE TABLE canonical_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  canonical_entity_id TEXT NOT NULL,
  duplicate_entity_id TEXT NOT NULL,
  similarity_score FLOAT NOT NULL,
  signals JSONB NOT NULL DEFAULT '{}',
  merged_by TEXT,
  merged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_canonical_link UNIQUE(workspace_id, canonical_entity_id, duplicate_entity_id)
);

CREATE INDEX idx_cel_workspace ON canonical_entity_links(workspace_id);
CREATE INDEX idx_cel_canonical ON canonical_entity_links(canonical_entity_id);
CREATE INDEX idx_cel_duplicate ON canonical_entity_links(duplicate_entity_id);
