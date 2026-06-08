-- Relationship inference: ML-suggested links and metrics

CREATE TABLE IF NOT EXISTS inferred_relationships (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               TEXT NOT NULL,
  source_entity_id           TEXT NOT NULL,
  target_entity_id           TEXT NOT NULL,
  relationship_type_predicted TEXT NOT NULL,
  confidence_score           NUMERIC(5, 4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  discovery_method           TEXT NOT NULL CHECK (discovery_method IN ('cooccurrence', 'embedding_similarity', 'metadata_pattern')),
  suggested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at               TIMESTAMPTZ,
  rejected_at                TIMESTAMPTZ,
  UNIQUE (workspace_id, source_entity_id, target_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_inferred_relationships_workspace_confidence
  ON inferred_relationships (workspace_id, confidence_score DESC)
  WHERE confirmed_at IS NULL AND rejected_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inferred_relationships_source
  ON inferred_relationships (workspace_id, source_entity_id);

CREATE TABLE IF NOT EXISTS relationship_inference_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  total_inferred  INTEGER NOT NULL DEFAULT 0,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  rejected_count  INTEGER NOT NULL DEFAULT 0,
  accuracy_ratio  NUMERIC(5, 4) NOT NULL DEFAULT 0,
  measured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relationship_inference_metrics_workspace
  ON relationship_inference_metrics (workspace_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS entity_cooccurrence_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  entity_a     TEXT NOT NULL,
  entity_b     TEXT NOT NULL,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_cooccurrence_log_workspace
  ON entity_cooccurrence_log (workspace_id, entity_a, logged_at DESC);
