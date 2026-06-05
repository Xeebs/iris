-- API keys for MCP server authentication with workspace isolation.

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id  TEXT        NOT NULL,
  key_hash      TEXT        NOT NULL UNIQUE,
  display_name  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_workspace
  ON mcp_api_keys(workspace_id);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash
  ON mcp_api_keys(key_hash) WHERE revoked_at IS NULL;

-- Tracks MCP server sessions for audit purposes.
CREATE TABLE IF NOT EXISTS mcp_audit_sessions (
  session_id      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  api_key_id      TEXT        REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
  workspace_id    TEXT        NOT NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_sessions_workspace
  ON mcp_audit_sessions(workspace_id, connected_at DESC);
