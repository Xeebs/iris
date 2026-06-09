-- Migration 168: Granular field-level and connector-level permission rules

CREATE TABLE IF NOT EXISTS field_permissions (
  permission_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  permission_type TEXT NOT NULL CHECK (permission_type IN ('view', 'edit', 'delete')),
  role_ids_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, entity_type, field_name, permission_type)
);

CREATE INDEX IF NOT EXISTS idx_field_perms_workspace ON field_permissions (workspace_id, entity_type);

CREATE TABLE IF NOT EXISTS connector_permissions (
  permission_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  role_ids_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_perms_workspace ON connector_permissions (workspace_id);
