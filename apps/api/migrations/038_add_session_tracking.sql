CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  browser_name TEXT,
  os_name TEXT,
  country_code CHAR(2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  device_name TEXT,
  fingerprint TEXT NOT NULL,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id, workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions (expires_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices (user_id, workspace_id);
