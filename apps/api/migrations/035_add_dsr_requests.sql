CREATE TABLE IF NOT EXISTS dsr_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  subject_identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('email', 'user_id', 'pii')),
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'erasure')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  requested_by TEXT,
  export_url TEXT,
  error_message TEXT,
  execute_after TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dsr_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dsr_request_id UUID NOT NULL REFERENCES dsr_requests(id),
  action TEXT NOT NULL,
  actor TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsr_workspace ON dsr_requests (workspace_id);
CREATE INDEX IF NOT EXISTS idx_dsr_status ON dsr_requests (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_dsr_audit_request ON dsr_audit_log (dsr_request_id);
