CREATE TABLE deadletter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  connector_instance_id UUID REFERENCES connector_instances(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  attempt_count INT NOT NULL DEFAULT 3,
  job_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retried_at TIMESTAMPTZ,
  retried_by TEXT
);

CREATE INDEX idx_dlq_instance ON deadletter_jobs(connector_instance_id, created_at DESC);
CREATE INDEX idx_dlq_workspace ON deadletter_jobs(workspace_id, created_at DESC);
CREATE INDEX idx_dlq_job_id ON deadletter_jobs(job_id);
