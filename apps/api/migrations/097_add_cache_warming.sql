-- Migration 097: Cache Prewarming Statistics

CREATE TABLE cache_prewarming_stats (
  id                     BIGSERIAL PRIMARY KEY,
  workspace_id           TEXT      NOT NULL,
  predicted_entity_ids   JSONB     NOT NULL DEFAULT '[]',
  loaded_count           INT       NOT NULL DEFAULT 0,
  actual_cache_hit_count INT       NOT NULL DEFAULT 0,
  accuracy_ratio         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  measured_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cache_prewarming_workspace ON cache_prewarming_stats(workspace_id, measured_at DESC);
CREATE INDEX idx_cache_prewarming_accuracy ON cache_prewarming_stats(workspace_id, accuracy_ratio DESC);
