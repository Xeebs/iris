-- Entity relationships discovered during indexing.
-- Stores directed edges (entity_id → related_entity_id) per workspace.
-- Used by the retrieval engine to expand context via graph traversal.

CREATE TABLE IF NOT EXISTS entity_relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  related_entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT entity_relationships_score_range CHECK (confidence_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS entity_relationships_entity_ws
  ON entity_relationships (workspace_id, entity_id);

CREATE INDEX IF NOT EXISTS entity_relationships_related_ws
  ON entity_relationships (workspace_id, related_entity_id);

-- Prevent duplicate edges within a workspace
CREATE UNIQUE INDEX IF NOT EXISTS entity_relationships_unique_edge
  ON entity_relationships (workspace_id, entity_id, related_entity_id, relationship_type);
