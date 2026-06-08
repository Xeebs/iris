-- Sync quality metrics: per-run statistics for each connector sync
CREATE TABLE IF NOT EXISTS sync_quality_metrics (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_id         TEXT        NOT NULL,
  connector_id    TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  entity_count    INTEGER     NOT NULL,
  completeness_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  unique_value_ratio NUMERIC(5,4) NOT NULL DEFAULT 0,
  schema_stability_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
  anomaly_flags   TEXT[]      NOT NULL DEFAULT '{}',
  attribute_names TEXT[]      NOT NULL DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_quality_connector
  ON sync_quality_metrics (connector_id, workspace_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_quality_workspace
  ON sync_quality_metrics (workspace_id, recorded_at DESC);

-- Per-connector threshold overrides (null = use global defaults)
CREATE TABLE IF NOT EXISTS sync_quality_thresholds (
  workspace_id                  TEXT    NOT NULL,
  connector_id                  TEXT    NOT NULL,
  entity_count_zscore_threshold NUMERIC(4,1) NOT NULL DEFAULT 3.0,
  completeness_drop_threshold   NUMERIC(4,2) NOT NULL DEFAULT 0.20,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, connector_id)
);
