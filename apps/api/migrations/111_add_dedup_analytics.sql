-- Migration 111: deduplication cluster analytics and decisions

CREATE TABLE IF NOT EXISTS dedup_clusters (
  cluster_id           TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id         TEXT         NOT NULL,
  entity_type          TEXT         NOT NULL,
  member_count         INTEGER      NOT NULL DEFAULT 2,
  canonical_entity_id  TEXT         NOT NULL,
  similarity_scores_json JSONB      NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  merged_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dedup_decisions (
  workspace_id           TEXT         NOT NULL,
  source_entity_id       TEXT         NOT NULL,
  target_entity_id       TEXT         NOT NULL,
  confidence_score       NUMERIC(5,4) NOT NULL DEFAULT 0.85,
  attributes_compared_json JSONB      NOT NULL DEFAULT '[]'::jsonb,
  merge_status           TEXT         NOT NULL DEFAULT 'pending'
    CHECK (merge_status IN ('pending', 'approved', 'rejected')),
  reviewed_by_user_id    TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, source_entity_id, target_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_dedup_clusters_workspace ON dedup_clusters (workspace_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_dedup_clusters_merged ON dedup_clusters (workspace_id, merged_at);
CREATE INDEX IF NOT EXISTS idx_dedup_decisions_status ON dedup_decisions (workspace_id, merge_status);
