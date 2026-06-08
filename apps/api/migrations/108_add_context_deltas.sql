-- Migration 108: MCP Client Context State & Delta Audit

CREATE TABLE IF NOT EXISTS mcp_client_context_state (
  client_id           TEXT        NOT NULL,
  workspace_id        TEXT        NOT NULL,
  last_query_hash     TEXT        NOT NULL,
  last_context_snapshot TEXT      NOT NULL,
  entities_served     TEXT[]      NOT NULL DEFAULT '{}',
  snapshot_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (client_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_client_state_workspace
  ON mcp_client_context_state (workspace_id);
CREATE INDEX IF NOT EXISTS idx_mcp_client_state_expires
  ON mcp_client_context_state (expires_at);

-- Delta delivery audit (token savings tracking)
CREATE TABLE IF NOT EXISTS context_delta_audit (
  delta_id                TEXT        NOT NULL PRIMARY KEY,
  client_id               TEXT        NOT NULL,
  entities_added_count    INTEGER     NOT NULL DEFAULT 0,
  entities_removed_count  INTEGER     NOT NULL DEFAULT 0,
  entities_modified_count INTEGER     NOT NULL DEFAULT 0,
  saved_tokens            INTEGER     NOT NULL DEFAULT 0,
  stream_chunks           INTEGER     NOT NULL DEFAULT 1,
  delivered_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_context_delta_audit_client
  ON context_delta_audit (client_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_delta_audit_delivered
  ON context_delta_audit (delivered_at DESC);
