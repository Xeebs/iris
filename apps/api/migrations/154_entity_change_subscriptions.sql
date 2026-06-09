-- Migration 154: Entity Change Subscriptions and Change Events

CREATE TABLE IF NOT EXISTS entity_change_subscriptions (
  subscription_id  TEXT        NOT NULL PRIMARY KEY,
  entity_id        TEXT,
  workspace_id     TEXT        NOT NULL,
  filters          JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active           BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_entity_change_subscriptions_workspace
  ON entity_change_subscriptions (workspace_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_change_subscriptions_entity
  ON entity_change_subscriptions (entity_id, active) WHERE entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS entity_change_events (
  change_id        TEXT        NOT NULL PRIMARY KEY,
  entity_id        TEXT        NOT NULL,
  entity_type      TEXT        NOT NULL,
  change_type      TEXT        NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted', 'attribute_changed')),
  previous_value   JSONB,
  new_value        JSONB,
  source           TEXT        NOT NULL DEFAULT '',
  workspace_id     TEXT        NOT NULL,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_change_events_entity
  ON entity_change_events (entity_id, workspace_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_change_events_workspace
  ON entity_change_events (workspace_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_change_events_type
  ON entity_change_events (entity_type, workspace_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS change_notifications (
  id               BIGSERIAL   PRIMARY KEY,
  change_id        TEXT        NOT NULL REFERENCES entity_change_events (change_id) ON DELETE CASCADE,
  subscription_id  TEXT        NOT NULL REFERENCES entity_change_subscriptions (subscription_id) ON DELETE CASCADE,
  notification_text TEXT       NOT NULL,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_notifications_subscription
  ON change_notifications (subscription_id, created_at DESC);
