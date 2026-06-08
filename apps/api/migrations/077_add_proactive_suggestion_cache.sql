-- Migration 077: Proactive Context — suggestion cache and query event log
-- Adds a TTL-aware suggestion cache to avoid recomputing suggestions on every request,
-- and a granular query event log for richer behavioral profile computation.

CREATE TABLE IF NOT EXISTS proactive_suggestion_cache (
  cache_key         TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  suggestions_json  JSONB NOT NULL DEFAULT '[]',
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestion_cache_expires ON proactive_suggestion_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_suggestion_cache_agent ON proactive_suggestion_cache(workspace_id, agent_id);

CREATE TABLE IF NOT EXISTS proactive_query_event_log (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  query_text      TEXT,
  entity_types    TEXT[] NOT NULL DEFAULT '{}',
  tokens_spent    INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_events_agent ON proactive_query_event_log(workspace_id, agent_id, logged_at DESC);
