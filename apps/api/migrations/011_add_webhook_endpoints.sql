-- Add webhook support to connector instances.
-- Each connector instance can have a unique secret token for webhook validation.

ALTER TABLE connector_instances
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

CREATE INDEX IF NOT EXISTS idx_connector_instances_webhook_secret
  ON connector_instances(webhook_secret)
  WHERE webhook_secret IS NOT NULL;
