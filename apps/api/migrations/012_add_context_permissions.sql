-- Role-based context access control for workspace isolation and field-level security.

CREATE TABLE IF NOT EXISTS context_roles (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id  TEXT        NOT NULL,
  role_name     TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_context_roles_workspace
  ON context_roles(workspace_id);

-- Which entity types and fields each role may access.
-- allowed_fields: JSON array of attribute names; empty array [] = all fields allowed.
CREATE TABLE IF NOT EXISTS role_entity_type_permissions (
  id             TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_id        TEXT   NOT NULL REFERENCES context_roles(id) ON DELETE CASCADE,
  entity_type    TEXT   NOT NULL,
  allowed_fields JSONB  NOT NULL DEFAULT '[]',
  UNIQUE (role_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON role_entity_type_permissions(role_id);

-- Link each API key to an optional role (null = unrestricted access).
ALTER TABLE mcp_api_keys
  ADD COLUMN IF NOT EXISTS role_id TEXT REFERENCES context_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_role
  ON mcp_api_keys(role_id) WHERE role_id IS NOT NULL;
