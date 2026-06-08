-- Migration 074: Entity Enrichment Engine
-- Stores external enrichment data per entity and configures enrichment sources.

CREATE TABLE enrichment_sources (
  source_id       TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  api_endpoint    TEXT,
  api_key_encrypted TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  rate_limit_rps  INTEGER NOT NULL DEFAULT 5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entity_enrichments (
  id                    BIGSERIAL PRIMARY KEY,
  entity_id             TEXT NOT NULL,
  workspace_id          UUID NOT NULL,
  enrichment_source     TEXT NOT NULL REFERENCES enrichment_sources(source_id) ON DELETE CASCADE,
  enrichment_data       JSONB NOT NULL DEFAULT '{}',
  confidence_score      NUMERIC(4,3) NOT NULL DEFAULT 0,
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  refresh_triggered_at  TIMESTAMPTZ,
  UNIQUE (entity_id, workspace_id, enrichment_source)
);

CREATE INDEX idx_entity_enrichments_entity ON entity_enrichments(entity_id, workspace_id);
CREATE INDEX idx_entity_enrichments_expires ON entity_enrichments(expires_at);
CREATE INDEX idx_entity_enrichments_source ON entity_enrichments(enrichment_source);

-- Seed built-in enrichment sources
INSERT INTO enrichment_sources (source_id, name, enabled, rate_limit_rps) VALUES
  ('company-enricher',   'Company Enricher (Clearbit)',    true, 10),
  ('person-enricher',    'Person Enricher (Clearbit)',     true, 10),
  ('sentiment-enricher', 'Sentiment Enricher (NewsAPI)',   true, 5);
