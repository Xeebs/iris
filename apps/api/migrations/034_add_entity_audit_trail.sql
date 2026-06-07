CREATE TABLE IF NOT EXISTS entity_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted')),
  changed_by TEXT NOT NULL CHECK (changed_by IN ('connector_sync', 'webhook', 'user_import', 'manual')),
  source_connector_id TEXT,
  old_values_json JSONB,
  new_values_json JSONB,
  changed_fields TEXT[],
  anomaly_flags TEXT[],
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_audit_workspace_entity
  ON entity_audit_events (workspace_id, entity_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_entity_audit_workspace_type
  ON entity_audit_events (workspace_id, entity_type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_entity_audit_timestamp
  ON entity_audit_events (workspace_id, timestamp DESC);
