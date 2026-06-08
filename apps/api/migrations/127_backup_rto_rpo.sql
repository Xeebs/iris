-- Migration 127: Backup manifests and RTO/RPO tracking for PITR capability

CREATE TABLE IF NOT EXISTS backup_manifests (
  id              TEXT        PRIMARY KEY,  -- UUID
  workspace_id    TEXT        NOT NULL,
  backup_type     TEXT        NOT NULL,     -- full | incremental
  status          TEXT        NOT NULL DEFAULT 'creating',  -- creating | ready | failed | pruned
  entity_count    INTEGER     NOT NULL DEFAULT 0,
  size_bytes      BIGINT      NOT NULL DEFAULT 0,
  checksum        TEXT,
  base_backup_id  TEXT,                     -- for incremental: which full backup this extends
  since_timestamp TIMESTAMPTZ,              -- for incremental: changes captured since
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS backup_manifests_workspace_started
  ON backup_manifests (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS backup_manifests_type_status
  ON backup_manifests (workspace_id, backup_type, status, started_at DESC);

COMMENT ON TABLE backup_manifests IS
  'Tracks backup manifests for PITR. Full backups are baselines; incrementals extend them.';
