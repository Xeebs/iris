-- MCP tool version registry and deprecation tracking
-- Stores registered handler versions so clients can negotiate compatible API versions.

CREATE TABLE IF NOT EXISTS mcp_tool_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name     TEXT NOT NULL,
  version       TEXT NOT NULL,
  schema_json   JSONB NOT NULL,
  handler_ref   TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tool_versions_tool_version_uq UNIQUE (tool_name, version)
);

CREATE INDEX IF NOT EXISTS mcp_tool_versions_tool_name_idx ON mcp_tool_versions (tool_name, is_active);

CREATE TABLE IF NOT EXISTS mcp_tool_deprecations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name   TEXT NOT NULL,
  version     TEXT NOT NULL,
  sunset_date TIMESTAMPTZ NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tool_deprecations_tool_version_uq UNIQUE (tool_name, version),
  CONSTRAINT mcp_tool_deprecations_version_fk FOREIGN KEY (tool_name, version)
    REFERENCES mcp_tool_versions (tool_name, version) ON DELETE CASCADE
);
