-- Auto-generated MCP tools from connector schemas

CREATE TABLE IF NOT EXISTS auto_generated_tools (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         TEXT NOT NULL,
  tool_id              TEXT NOT NULL,
  source_connector_id  TEXT NOT NULL,
  entity_type          TEXT NOT NULL,
  tool_definition_json JSONB NOT NULL DEFAULT '{}',
  version              INTEGER NOT NULL DEFAULT 1,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_invoked_at      TIMESTAMPTZ,
  UNIQUE (workspace_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_generated_tools_workspace
  ON auto_generated_tools (workspace_id, source_connector_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_auto_generated_tools_invoked
  ON auto_generated_tools (workspace_id, last_invoked_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS tool_version_history (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           TEXT NOT NULL,
  tool_id                TEXT NOT NULL,
  version                INTEGER NOT NULL,
  schema_changes         TEXT[] NOT NULL DEFAULT '{}',
  is_backward_compatible BOOLEAN NOT NULL DEFAULT TRUE,
  deprecation_warning    TEXT,
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_version_history_tool
  ON tool_version_history (workspace_id, tool_id, version DESC);
