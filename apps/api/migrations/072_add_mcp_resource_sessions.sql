-- Migration: 072 — MCP resource streaming sessions
-- Caches progressive context expansion state for streaming sessions.

CREATE TABLE IF NOT EXISTS mcp_resource_sessions (
  session_id          text PRIMARY KEY,
  workspace_id        text NOT NULL,
  client_id           text NOT NULL,
  query               text NOT NULL,
  expansion_level     text NOT NULL CHECK (expansion_level IN ('summary', 'detailed', 'full')),
  cached_results_json jsonb NOT NULL DEFAULT '[]',
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_workspace_client
  ON mcp_resource_sessions (workspace_id, client_id, query, expansion_level);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_expires
  ON mcp_resource_sessions (expires_at);
