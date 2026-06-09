-- Migration 137: data retention policies and entity archival

CREATE TABLE IF NOT EXISTS retention_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    TEXT NOT NULL UNIQUE,
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  archive_action TEXT NOT NULL DEFAULT 'soft_delete' CHECK (archive_action IN ('soft_delete','cold_storage','purge')),
  conditions     JSONB NOT NULL DEFAULT '[]',
  description    TEXT NOT NULL DEFAULT '',
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archived_entities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  reason              TEXT NOT NULL,
  archive_action      TEXT NOT NULL DEFAULT 'cold_storage',
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovery_window_days INTEGER NOT NULL DEFAULT 30,
  recovery_deadline   TIMESTAMPTZ NOT NULL,
  UNIQUE (entity_id)
);

CREATE TABLE IF NOT EXISTS archival_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('archived','restored','purged')),
  reason      TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT 'system',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archived_entities_type ON archived_entities(entity_type, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_entities_deadline ON archived_entities(recovery_deadline);
CREATE INDEX IF NOT EXISTS idx_archival_audit_entity ON archival_audit(entity_id, occurred_at DESC);
