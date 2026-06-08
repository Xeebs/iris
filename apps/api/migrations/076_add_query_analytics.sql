-- Migration 076: Query Analytics & Intelligent Query Caching

CREATE TABLE query_events (
  query_id          TEXT PRIMARY KEY,
  workspace_id      UUID NOT NULL,
  user_id           TEXT,
  query_text        TEXT NOT NULL,
  query_signature   TEXT NOT NULL,
  entity_types      TEXT[] NOT NULL DEFAULT '{}',
  cache_hit         BOOLEAN NOT NULL DEFAULT false,
  latency_ms        INTEGER NOT NULL,
  tokens_spent      INTEGER NOT NULL DEFAULT 0,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_query_events_workspace ON query_events(workspace_id, timestamp DESC);
CREATE INDEX idx_query_events_signature ON query_events(workspace_id, query_signature);
CREATE INDEX idx_query_events_timestamp ON query_events(timestamp DESC);

CREATE TABLE query_patterns (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      UUID NOT NULL,
  pattern_type      TEXT NOT NULL CHECK (pattern_type IN ('temporal', 'user', 'entity_type')),
  pattern_definition JSONB NOT NULL,
  confidence_score  NUMERIC(4,3) NOT NULL DEFAULT 0,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, pattern_type, (pattern_definition->>'type'))
);

CREATE INDEX idx_query_patterns_workspace ON query_patterns(workspace_id, pattern_type);

CREATE TABLE cache_warming_jobs (
  warming_job_id              TEXT PRIMARY KEY,
  workspace_id                UUID NOT NULL,
  trigger_query_signatures    TEXT[] NOT NULL DEFAULT '{}',
  executed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_hit_improvement_rate  NUMERIC(5,4)
);

CREATE INDEX idx_cache_warming_workspace ON cache_warming_jobs(workspace_id, executed_at DESC);
