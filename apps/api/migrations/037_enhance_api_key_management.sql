-- Add rotation and lifecycle fields to mcp_api_keys
ALTER TABLE mcp_api_keys
  ADD COLUMN IF NOT EXISTS key_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_schedule_days INT,
  ADD COLUMN IF NOT EXISTS previous_key_hashes JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_status
  ON mcp_api_keys (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
  ON mcp_api_keys (expires_at)
  WHERE expires_at IS NOT NULL;
