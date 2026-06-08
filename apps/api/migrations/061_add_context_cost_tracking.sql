-- Migration 061: Context cost tracking for fine-grained attribution

CREATE TABLE IF NOT EXISTS context_cost_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      text NOT NULL,
  query_hash        text NOT NULL,
  entities_returned integer NOT NULL DEFAULT 0,
  tokens_spent      integer NOT NULL DEFAULT 0,
  tokens_saved      integer NOT NULL DEFAULT 0,
  cache_hit         boolean NOT NULL DEFAULT false,
  source_connectors text[] NOT NULL DEFAULT '{}',
  entity_types      text[] NOT NULL DEFAULT '{}',
  timestamp         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_cost_workspace_ts
  ON context_cost_events (workspace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_context_cost_connectors
  ON context_cost_events USING GIN (source_connectors);

CREATE INDEX IF NOT EXISTS idx_context_cost_entity_types
  ON context_cost_events USING GIN (entity_types);
