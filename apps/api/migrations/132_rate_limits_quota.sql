-- Migration 132: rate limits and quota management
-- Tables for sliding-window rate limiting and quota override requests

CREATE TABLE IF NOT EXISTS rate_limit_configs (
  workspace_id   UUID PRIMARY KEY,
  tier           TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','pro','enterprise')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quota_usage (
  workspace_id   UUID NOT NULL,
  endpoint       TEXT NOT NULL,
  window_key     BIGINT NOT NULL,
  window_ms      BIGINT NOT NULL,
  request_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, endpoint, window_key)
);

CREATE TABLE IF NOT EXISTS quota_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  endpoint       TEXT NOT NULL,
  override_limit INTEGER NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  granted_by     TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quota_increase_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL,
  requested_tier TEXT NOT NULL CHECK (requested_tier IN ('pro','enterprise')),
  justification  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_usage_workspace_id ON quota_usage(workspace_id);
CREATE INDEX IF NOT EXISTS idx_quota_usage_window_key ON quota_usage(window_key);
CREATE INDEX IF NOT EXISTS idx_quota_overrides_workspace_id ON quota_overrides(workspace_id);
CREATE INDEX IF NOT EXISTS idx_quota_overrides_expires_at ON quota_overrides(expires_at);
CREATE INDEX IF NOT EXISTS idx_quota_increase_requests_status ON quota_increase_requests(status);
CREATE INDEX IF NOT EXISTS idx_quota_increase_requests_workspace_id ON quota_increase_requests(workspace_id);
