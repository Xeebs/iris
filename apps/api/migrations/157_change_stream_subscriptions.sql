-- Migration 157: Add subscription_filters JSONB column if missing
-- entity_change_subscriptions was created in migration 154, but may lack subscription_filters

ALTER TABLE entity_change_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_filters JSONB;

-- Index for fast subscription lookup by entity and workspace
CREATE INDEX IF NOT EXISTS idx_ecs_workspace_entity ON entity_change_subscriptions (workspace_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_ecs_active ON entity_change_subscriptions (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_ece_entity_workspace ON entity_change_events (entity_id, workspace_id, changed_at DESC);
