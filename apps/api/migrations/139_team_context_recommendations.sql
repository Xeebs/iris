-- Migration 139: team context usage tracking and recommendations

CREATE TABLE IF NOT EXISTS team_context_usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          TEXT NOT NULL,
  role_id          TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  access_count     INTEGER NOT NULL DEFAULT 1,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, role_id, entity_id)
);

CREATE TABLE IF NOT EXISTS role_context_affinities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id        TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  affinity_score NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (affinity_score BETWEEN 0 AND 1),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, entity_type)
);

CREATE TABLE IF NOT EXISTS team_recommendations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  preference  TEXT NOT NULL CHECK (preference IN ('pin', 'dismiss')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, entity_id)
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  was_helpful     BOOLEAN NOT NULL,
  feedback_source TEXT NOT NULL DEFAULT 'explicit',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_context_usage_team_id ON team_context_usage(team_id, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_context_usage_role_id ON team_context_usage(role_id);
CREATE INDEX IF NOT EXISTS idx_role_context_affinities_role ON role_context_affinities(role_id);
