-- Migration 115: import_jobs table for tracking async bulk import operations

CREATE TABLE IF NOT EXISTS import_jobs (
  job_id          TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  file_name       TEXT        NOT NULL DEFAULT '',
  format          TEXT        NOT NULL DEFAULT 'json',
  record_count    INTEGER     NOT NULL DEFAULT 0,
  imported_count  INTEGER     NOT NULL DEFAULT 0,
  error_count     INTEGER     NOT NULL DEFAULT 0,
  errors_json     JSONB       NOT NULL DEFAULT '[]',
  status          TEXT        NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_jobs_workspace_created
  ON import_jobs (workspace_id, created_at DESC);

COMMENT ON TABLE import_jobs IS
  'Tracks async bulk entity import operations; polled by dashboard for progress.';
