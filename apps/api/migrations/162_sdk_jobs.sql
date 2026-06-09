-- Migration 162: SDK generation job tracking

CREATE TABLE IF NOT EXISTS sdk_generation_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('typescript', 'python', 'go')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
  tool_count INTEGER,
  download_url TEXT,
  error_message TEXT,
  sdk_version TEXT NOT NULL DEFAULT '0.1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sdk_jobs_workspace ON sdk_generation_jobs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_sdk_jobs_status ON sdk_generation_jobs (status);
