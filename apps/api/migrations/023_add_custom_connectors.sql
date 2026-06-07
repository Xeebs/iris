CREATE TABLE custom_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled', 'error')),
  install_path TEXT NOT NULL,
  manifest JSONB NOT NULL,
  validation_errors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_custom_connectors_workspace_name
  ON custom_connectors(workspace_id, name);
CREATE INDEX idx_custom_connectors_workspace_status
  ON custom_connectors(workspace_id, status);
