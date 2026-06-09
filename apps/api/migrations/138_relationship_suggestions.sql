-- Migration 138: Relationship Suggestions & Auto-Linking Engine
-- Stores suggested relationships between entities, user feedback, and auto-link records.

CREATE TABLE IF NOT EXISTS relationship_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id         TEXT NOT NULL,
  to_id           TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence      NUMERIC(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasons         JSONB NOT NULL DEFAULT '[]',
  auto_approved   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_id, to_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS relationship_suggestions_from_id_idx ON relationship_suggestions (from_id);
CREATE INDEX IF NOT EXISTS relationship_suggestions_to_id_idx ON relationship_suggestions (to_id);
CREATE INDEX IF NOT EXISTS relationship_suggestions_confidence_idx ON relationship_suggestions (confidence DESC);

CREATE TABLE IF NOT EXISTS relationship_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  accepted    BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_id, to_id)
);

CREATE INDEX IF NOT EXISTS relationship_feedback_from_id_idx ON relationship_feedback (from_id);
CREATE INDEX IF NOT EXISTS relationship_feedback_to_id_idx ON relationship_feedback (to_id);
CREATE INDEX IF NOT EXISTS relationship_feedback_accepted_idx ON relationship_feedback (accepted);

CREATE TABLE IF NOT EXISTS suggestion_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_suggested INT NOT NULL DEFAULT 0,
  accepted_count  INT NOT NULL DEFAULT 0,
  denied_count    INT NOT NULL DEFAULT 0,
  auto_link_count INT NOT NULL DEFAULT 0
);
