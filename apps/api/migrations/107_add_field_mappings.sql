-- Smart schema field mappings and learned transformations

CREATE TABLE IF NOT EXISTS learned_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_connector_id   TEXT NOT NULL,
  source_field_name     TEXT NOT NULL,
  target_field_name     TEXT NOT NULL,
  target_entity_type    TEXT NOT NULL,
  mapping_count         INTEGER NOT NULL DEFAULT 0,
  user_confirmed_count  INTEGER NOT NULL DEFAULT 0,
  confidence_score      NUMERIC(5, 4) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_connector_id, source_field_name, target_field_name, target_entity_type)
);

CREATE INDEX IF NOT EXISTS idx_learned_mappings_connector
  ON learned_mappings (source_connector_id, target_entity_type, confidence_score DESC);

CREATE TABLE IF NOT EXISTS mapping_transformations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT NOT NULL,
  transformation_type  TEXT NOT NULL CHECK (transformation_type IN ('direct', 'aggregate', 'compute', 'lookup')),
  source_fields        TEXT[] NOT NULL DEFAULT '{}',
  target_field         TEXT NOT NULL,
  logic_expression     TEXT NOT NULL,
  created_by_user_id   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mapping_transformations_workspace
  ON mapping_transformations (workspace_id, transformation_type);
