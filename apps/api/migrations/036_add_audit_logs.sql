CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  action TEXT NOT NULL CHECK (action IN (
    'entity_read', 'entity_write', 'config_change',
    'permission_change', 'connector_sync', 'dsr_executed', 'login', 'logout'
  )),
  resource_type TEXT,
  resource_id TEXT,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (workspace_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (workspace_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (workspace_id, resource_type, resource_id);
