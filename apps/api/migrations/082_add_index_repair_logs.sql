-- Migration 082: Index Integrity Scans & Rebuild Jobs
-- Tracks index health scans and repair/rebuild operations per workspace.

CREATE TABLE IF NOT EXISTS integrity_scans (
  scan_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  issue_count  INT         NOT NULL DEFAULT 0,
  report_json  JSONB
);

CREATE INDEX IF NOT EXISTS idx_integrity_scans_workspace
  ON integrity_scans (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS rebuild_jobs (
  job_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT        NOT NULL,
  entity_type_filter   TEXT,
  status               TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  estimated_entities   INT,
  reindexed_count      INT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  error_message        TEXT
);

CREATE INDEX IF NOT EXISTS idx_rebuild_jobs_workspace
  ON rebuild_jobs (workspace_id, started_at DESC);
