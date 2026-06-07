-- Stores proactive context suggestions generated per workspace/user session.
-- Used both as a delivery mechanism and for analysis of entity co-occurrence patterns.

CREATE TABLE IF NOT EXISTS context_suggestions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT         NOT NULL,
  user_id       TEXT         NOT NULL DEFAULT 'system',
  entity_type   TEXT         NOT NULL,
  entity_label  TEXT         NOT NULL,
  entity_id     TEXT,
  reason        TEXT         NOT NULL DEFAULT '',
  confidence    REAL         NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  suggested_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS context_suggestions_workspace_user
  ON context_suggestions (workspace_id, user_id, suggested_at DESC);

CREATE INDEX IF NOT EXISTS context_suggestions_entity_type
  ON context_suggestions (workspace_id, entity_type);
