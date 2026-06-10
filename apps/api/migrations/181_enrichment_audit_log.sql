-- EnrichmentQualityScorer's ROI assessment reads per-enrichment token costs
-- and completeness gains from enrichment_audit_log, which was never created
-- — assessEnrichmentROI failed with 42P01.

CREATE TABLE IF NOT EXISTS enrichment_audit_log (
  id                BIGSERIAL PRIMARY KEY,
  connector_id      TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  token_cost        INTEGER NOT NULL DEFAULT 0,
  completeness_gain NUMERIC(5,4) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_audit_connector
  ON enrichment_audit_log (connector_id, workspace_id, created_at DESC);
