-- Migration 062: index maintenance job audit trail

CREATE TABLE IF NOT EXISTS index_maintenance_jobs (
  id               UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT                NOT NULL,
  job_type         TEXT                NOT NULL
                     CHECK (job_type IN ('deduplicate','prune_stale','rebalance','integrity_check')),
  status           TEXT                NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','completed','failed')),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  duration_ms      INTEGER,
  records_affected INTEGER,
  error_message    TEXT,
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imj_workspace_created
  ON index_maintenance_jobs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_imj_job_type
  ON index_maintenance_jobs (workspace_id, job_type);

CREATE INDEX IF NOT EXISTS idx_imj_status
  ON index_maintenance_jobs (status)
  WHERE status IN ('pending', 'running');
