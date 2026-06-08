-- Migration: Add MCP subscription management tables

CREATE TABLE IF NOT EXISTS mcp_subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  filters_json     JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_subscriptions_workspace
  ON mcp_subscriptions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_subscriptions_client
  ON mcp_subscriptions (workspace_id, client_id);

CREATE TABLE IF NOT EXISTS mcp_notification_events (
  event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES mcp_subscriptions(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('entity.created', 'entity.updated', 'entity.deleted')),
  entity_id         TEXT NOT NULL,
  payload_json      JSONB NOT NULL DEFAULT '{}',
  delivered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_notification_events_subscription
  ON mcp_notification_events (subscription_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_notification_events_entity
  ON mcp_notification_events (entity_id, notification_type);
