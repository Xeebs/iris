-- Workspace deletion policies and lifecycle tracking
CREATE TABLE IF NOT EXISTS workspace_deletion_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL UNIQUE,
  retention_days INT NOT NULL DEFAULT 30,
  backup_before_deletion BOOLEAN NOT NULL DEFAULT true,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_policies_workspace
  ON workspace_deletion_policies (workspace_id);

-- Tracks pending/active/completed workspace deletions
CREATE TABLE IF NOT EXISTS workspace_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'backup_in_progress', 'completed')),
  scheduled_at TIMESTAMPTZ NOT NULL,  -- when the hard delete will execute
  backup_export_id TEXT,              -- export job id from export_jobs table
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_workspace
  ON workspace_deletion_requests (workspace_id);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status
  ON workspace_deletion_requests (status, scheduled_at);

-- Audit log for all deletion lifecycle events
CREATE TABLE IF NOT EXISTS workspace_deletion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event TEXT NOT NULL,
  performed_by TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_audit_workspace
  ON workspace_deletion_audit (workspace_id, created_at DESC);
