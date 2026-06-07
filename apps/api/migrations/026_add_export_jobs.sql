CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  export_type TEXT NOT NULL CHECK (export_type IN ('full', 'entities', 'schema')),
  options JSONB,
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  entity_count INT,
  result_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_export_jobs_workspace ON export_jobs(workspace_id, created_at DESC);
CREATE INDEX idx_export_jobs_status ON export_jobs(status, created_at DESC);
