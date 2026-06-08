-- Migration 078: Enhance data lineage with entity dependencies and impact analysis
-- Adds entity_dependencies for tracking derived/referenced relationships,
-- and a materialized-style view for downstream impact analysis.

CREATE TABLE IF NOT EXISTS entity_dependencies (
  id                    BIGSERIAL PRIMARY KEY,
  entity_id             TEXT NOT NULL,
  depends_on_entity_id  TEXT NOT NULL,
  workspace_id          TEXT NOT NULL,
  relationship_type     TEXT NOT NULL DEFAULT 'references'
    CHECK (relationship_type IN ('references', 'contains', 'derived_from', 'shares_owner')),
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, depends_on_entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_deps_entity ON entity_dependencies(entity_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_entity_deps_upstream ON entity_dependencies(depends_on_entity_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_entity_deps_workspace ON entity_dependencies(workspace_id, relationship_type);

-- Lineage transformation tracking (separate table for high-volume transform events)
CREATE TABLE IF NOT EXISTS entity_lineage_transformations (
  id               BIGSERIAL PRIMARY KEY,
  entity_id        TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  transformation_type TEXT NOT NULL
    CHECK (transformation_type IN ('embedding', 'deduplication', 'relationship', 'pii_masking', 'enrichment', 'aggregation')),
  source_entity_ids TEXT[] NOT NULL DEFAULT '{}',
  transformation_details JSONB NOT NULL DEFAULT '{}',
  transformed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lineage_transforms_entity ON entity_lineage_transformations(entity_id, workspace_id, transformed_at DESC);
