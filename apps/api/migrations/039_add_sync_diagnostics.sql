CREATE TABLE IF NOT EXISTS sync_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id TEXT NOT NULL,
  connector_instance_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  error_category TEXT NOT NULL CHECK (error_category IN (
    'auth_failure', 'rate_limit', 'network_timeout',
    'schema_mismatch', 'data_validation', 'quota_exceeded', 'unknown'
  )),
  error_message TEXT NOT NULL,
  error_details JSONB NOT NULL DEFAULT '{}',
  recovery_suggestions JSONB NOT NULL DEFAULT '[]',
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_diag_connector ON sync_diagnostics (connector_instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_diag_workspace ON sync_diagnostics (workspace_id);
CREATE INDEX IF NOT EXISTS idx_sync_diag_unresolved ON sync_diagnostics (workspace_id, is_resolved) WHERE NOT is_resolved;
