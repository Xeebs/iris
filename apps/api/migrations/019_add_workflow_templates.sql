-- Agent workflow templates: pre-configured MCP query patterns for AI agents.

CREATE TABLE IF NOT EXISTS workflow_templates (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id   TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_name  TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  trigger_type   TEXT        NOT NULL DEFAULT 'manual'
                             CHECK (trigger_type IN ('manual', 'calendar', 'entity_change')),
  trigger_config JSONB       NOT NULL DEFAULT '{}',
  mcp_calls      JSONB       NOT NULL DEFAULT '[]',
  response_format TEXT       NOT NULL DEFAULT 'text'
                             CHECK (response_format IN ('text', 'json', 'markdown')),
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT workflow_templates_unique_name UNIQUE (workspace_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace
  ON workflow_templates(workspace_id, is_active, created_at DESC);
