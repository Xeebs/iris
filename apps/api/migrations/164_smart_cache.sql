-- Migration 164: Smart cache statistics and dependency tracking

CREATE TABLE IF NOT EXISTS query_dependencies (
  dep_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_hash, entity_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_query_deps_entity ON query_dependencies (entity_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_query_deps_query ON query_dependencies (query_hash, workspace_id);

CREATE TABLE IF NOT EXISTS cache_statistics (
  stat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  query_text TEXT,
  entity_type TEXT,
  total_requests INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  total_saved_tokens INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_cache_stats_workspace ON cache_statistics (workspace_id, cache_hits DESC);

CREATE TABLE IF NOT EXISTS user_query_patterns (
  pattern_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_patterns_user ON user_query_patterns (workspace_id, user_id, observed_at DESC);
