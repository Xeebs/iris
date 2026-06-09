-- Migration 146: Multi-Connector Entity Matching & Reconciliation Engine
-- Stores cross-connector match candidates and human reconciliation decisions.

CREATE TABLE IF NOT EXISTS entity_matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        TEXT NOT NULL,
  candidate_id     TEXT NOT NULL,
  confidence       NUMERIC(5, 4) NOT NULL,
  attribute_overlap NUMERIC(5, 4) NOT NULL DEFAULT 0,
  embedding_distance NUMERIC(5, 4) NOT NULL DEFAULT 0,
  reasons          JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS entity_matches_source_idx ON entity_matches (source_id, confidence DESC);
CREATE INDEX IF NOT EXISTS entity_matches_candidate_idx ON entity_matches (candidate_id);
CREATE INDEX IF NOT EXISTS entity_matches_confidence_idx ON entity_matches (confidence DESC);

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('merge', 'link', 'reject')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, target_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_records_source_idx ON reconciliation_records (source_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS match_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_run_id  TEXT NOT NULL,
  entity_count  INT NOT NULL DEFAULT 0,
  match_count   INT NOT NULL DEFAULT 0,
  merge_count   INT NOT NULL DEFAULT 0,
  link_count    INT NOT NULL DEFAULT 0,
  reject_count  INT NOT NULL DEFAULT 0,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
