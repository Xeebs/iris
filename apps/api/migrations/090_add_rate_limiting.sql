-- Rate limiting: per-workspace tier configs and sliding window usage buckets.

CREATE TABLE IF NOT EXISTS rate_limit_configs (
  workspace_id TEXT PRIMARY KEY,
  tier         TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','pro','enterprise')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quota_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  window_key    BIGINT NOT NULL,
  window_ms     BIGINT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT quota_usage_uq UNIQUE (workspace_id, endpoint, window_key)
);

CREATE INDEX IF NOT EXISTS quota_usage_lookup_idx ON quota_usage (workspace_id, window_key);

CREATE TABLE IF NOT EXISTS quota_reset_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  reset_type   TEXT NOT NULL CHECK (reset_type IN ('manual','tier_change','billing_cycle')),
  reset_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by TEXT
);
