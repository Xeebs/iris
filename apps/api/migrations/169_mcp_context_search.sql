-- Migration 169: MCP response context search index

CREATE TABLE IF NOT EXISTS mcp_response_cache (
  response_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  context_entities_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_mcp_cache_workspace ON mcp_response_cache (workspace_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS context_search_results (
  result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id TEXT NOT NULL REFERENCES mcp_response_cache(response_id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  result_rank INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  match_score NUMERIC NOT NULL,
  matching_fields_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_context_results_response ON context_search_results (response_id, result_rank);
