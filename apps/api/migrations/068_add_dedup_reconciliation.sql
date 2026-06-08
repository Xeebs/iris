-- Migration: 068 — Deduplication Reconciliation
-- Stores candidate duplicate pairs and reconciliation decisions.

CREATE TABLE IF NOT EXISTS dedup_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     text NOT NULL,
  source_entity_id text NOT NULL,
  candidate_entity_id text NOT NULL,
  similarity_score numeric(5,4) NOT NULL,
  detection_method text NOT NULL DEFAULT 'embedding',
  detected_at      timestamptz NOT NULL DEFAULT now(),
  reviewed         boolean NOT NULL DEFAULT false,
  decision         text CHECK (decision IN ('merge', 'keep-separate', 'ignore')) DEFAULT NULL,
  decided_at       timestamptz DEFAULT NULL,
  decided_by       text DEFAULT NULL,
  UNIQUE (workspace_id, source_entity_id, candidate_entity_id)
);

CREATE TABLE IF NOT EXISTS dedup_merge_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        text NOT NULL,
  canonical_entity_id text NOT NULL,
  merged_entity_id    text NOT NULL,
  merged_at           timestamptz NOT NULL DEFAULT now(),
  merged_by           text NOT NULL,
  reverted            boolean NOT NULL DEFAULT false,
  reverted_at         timestamptz DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedup_candidates_workspace_reviewed
  ON dedup_candidates (workspace_id, reviewed);
CREATE INDEX IF NOT EXISTS idx_dedup_candidates_score
  ON dedup_candidates (workspace_id, similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_dedup_merge_log_workspace
  ON dedup_merge_log (workspace_id, merged_at DESC);
