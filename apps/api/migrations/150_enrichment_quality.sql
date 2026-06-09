-- Migration 150: Enrichment quality scoring tables

CREATE TABLE IF NOT EXISTS enrichment_quality_scores (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  connector_id    TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  completeness    NUMERIC(5,2) NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  required_hit_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  source_diversity NUMERIC(5,4) NOT NULL DEFAULT 0,
  refresh_lag_sec BIGINT NOT NULL DEFAULT 0,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_eqs_connector ON enrichment_quality_scores (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_eqs_entity_type ON enrichment_quality_scores (entity_type, workspace_id);
CREATE INDEX IF NOT EXISTS idx_eqs_completeness ON enrichment_quality_scores (completeness);

CREATE TABLE IF NOT EXISTS enrichment_gaps (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  connector_id    TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  field_name      TEXT NOT NULL,
  null_count      INTEGER NOT NULL DEFAULT 0,
  total_count     INTEGER NOT NULL DEFAULT 0,
  null_rate       NUMERIC(5,4) NOT NULL DEFAULT 0,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id, entity_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_eg_connector ON enrichment_gaps (connector_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_eg_null_rate ON enrichment_gaps (null_rate DESC);

CREATE TABLE IF NOT EXISTS source_reliability_feedback (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  accuracy_rating NUMERIC(3,2) CHECK (accuracy_rating BETWEEN 0 AND 1),
  confidence_avg  NUMERIC(4,3) NOT NULL DEFAULT 0,
  feedback_count  INTEGER NOT NULL DEFAULT 0,
  last_feedback   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_srf_source ON source_reliability_feedback (source_id, workspace_id);
