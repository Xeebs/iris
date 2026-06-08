-- Query clustering and adaptive cache TTL

CREATE TABLE IF NOT EXISTS query_clusters (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                 TEXT NOT NULL,
  cluster_id                   TEXT NOT NULL,
  cluster_signature            JSONB NOT NULL DEFAULT '{}',
  member_count                 INTEGER NOT NULL DEFAULT 0,
  dominant_entity_types        TEXT[] NOT NULL DEFAULT '{}',
  update_frequency_percentile  NUMERIC(5, 2) NOT NULL DEFAULT 50,
  optimal_ttl_seconds          INTEGER NOT NULL DEFAULT 900,
  confidence_score             NUMERIC(5, 4) NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_query_clusters_workspace
  ON query_clusters (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_clusters_entity_types
  ON query_clusters USING GIN (dominant_entity_types);

CREATE TABLE IF NOT EXISTS query_membership (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash       TEXT NOT NULL,
  cluster_id       TEXT NOT NULL,
  similarity_score NUMERIC(5, 4) NOT NULL CHECK (similarity_score BETWEEN -1 AND 1),
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_hash, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_query_membership_cluster
  ON query_membership (cluster_id, similarity_score DESC);

CREATE TABLE IF NOT EXISTS cache_invalidation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  trigger_entity_type TEXT NOT NULL,
  affected_clusters   TEXT[] NOT NULL DEFAULT '{}',
  cascade_depth       INTEGER NOT NULL DEFAULT 0,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_invalidation_events_workspace
  ON cache_invalidation_events (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cache_invalidation_events_trigger
  ON cache_invalidation_events (workspace_id, trigger_entity_type, occurred_at DESC);
