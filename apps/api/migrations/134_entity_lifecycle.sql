-- Migration 134: entity lifecycle states, events, and approvals

CREATE TABLE IF NOT EXISTS entity_lifecycle_states (
  entity_id           TEXT PRIMARY KEY,
  current_status      TEXT NOT NULL CHECK (current_status IN ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  last_transition_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sunset_date         TIMESTAMPTZ,
  replacement_entity_id TEXT
);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    TEXT NOT NULL,
  from_status  TEXT CHECK (from_status IN ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  to_status    TEXT NOT NULL CHECK (to_status IN ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  reason       TEXT NOT NULL DEFAULT '',
  actor        TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entity_approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    TEXT NOT NULL,
  approver_id  TEXT NOT NULL,
  conditions   TEXT,
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_entity_id ON lifecycle_events(entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_states_status ON entity_lifecycle_states(current_status);
CREATE INDEX IF NOT EXISTS idx_entity_approvals_entity_id ON entity_approvals(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_sunset ON entity_lifecycle_states(sunset_date) WHERE sunset_date IS NOT NULL;
