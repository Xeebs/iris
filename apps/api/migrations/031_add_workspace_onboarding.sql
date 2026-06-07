-- Workspace onboarding state tracking
CREATE TABLE IF NOT EXISTS workspace_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'skipped')),
  current_step INT NOT NULL DEFAULT 1,
  completed_steps INT[] NOT NULL DEFAULT '{}',
  industry TEXT,
  company_size TEXT,
  use_case TEXT,
  selected_connectors TEXT[] NOT NULL DEFAULT '{}',
  first_sync_triggered BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_workspace
  ON workspace_onboarding (workspace_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_status
  ON workspace_onboarding (status, current_step);
