-- Tracks async bulk import and export jobs for data migration and testing workflows.

CREATE TABLE IF NOT EXISTS import_export_jobs (
  id             TEXT            PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id   TEXT            NOT NULL,
  type           TEXT            NOT NULL CHECK (type IN ('import', 'export')),
  status         TEXT            NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  file_name      TEXT,
  file_size_bytes BIGINT,
  format         TEXT            CHECK (format IN ('csv', 'json', 'parquet')),
  record_count   INTEGER,
  error_message  TEXT,
  result_url     TEXT,
  created_by     TEXT            NOT NULL DEFAULT 'system',
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_export_jobs_workspace
  ON import_export_jobs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_export_jobs_status
  ON import_export_jobs (workspace_id, status, type);
