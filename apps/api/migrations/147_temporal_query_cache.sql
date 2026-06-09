-- Migration 147: Temporal query cache with time-based versioning and hit analysis

CREATE TABLE IF NOT EXISTS temporal_query_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash    TEXT NOT NULL,
  query_text    TEXT NOT NULL,
  result_payload JSONB NOT NULL,
  as_of_date    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (query_hash, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_temporal_cache_hash_date
  ON temporal_query_cache (query_hash, as_of_date DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_cache_expires
  ON temporal_query_cache (expires_at)
  WHERE expires_at > NOW();

CREATE TABLE IF NOT EXISTS cache_hit_analysis (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash   TEXT NOT NULL,
  hit          BOOLEAN NOT NULL,
  as_of_date   TIMESTAMPTZ,
  latency_ms   INTEGER NOT NULL DEFAULT 0,
  miss_reason  TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_hits_hash
  ON cache_hit_analysis (query_hash, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_cache_hits_recorded
  ON cache_hit_analysis (recorded_at DESC);

CREATE TABLE IF NOT EXISTS cache_warming_log (
  query_hash   TEXT PRIMARY KEY,
  query_text   TEXT NOT NULL,
  warmed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 0
);
