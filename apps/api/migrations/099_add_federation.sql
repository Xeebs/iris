-- Workspace federation: trust relationships and fine-grained permissions

CREATE TABLE IF NOT EXISTS federated_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_workspace_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  relationship_type   TEXT NOT NULL CHECK (relationship_type IN ('parent_child', 'sibling', 'partner')),
  created_by_user_id  TEXT NOT NULL,
  trusted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_workspace_id, target_workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_federated_relationships_source
  ON federated_relationships (source_workspace_id);

CREATE TABLE IF NOT EXISTS federation_permissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id      UUID NOT NULL REFERENCES federated_relationships (id) ON DELETE CASCADE,
  entity_type_pattern  TEXT NOT NULL,
  can_read             BOOLEAN NOT NULL DEFAULT TRUE,
  can_write            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (relationship_id, entity_type_pattern)
);

CREATE INDEX IF NOT EXISTS idx_federation_permissions_relationship
  ON federation_permissions (relationship_id);

CREATE TABLE IF NOT EXISTS federation_access_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id             TEXT NOT NULL,
  source_workspace_id  TEXT NOT NULL,
  queried_workspaces   JSONB NOT NULL DEFAULT '[]',
  entity_count         INTEGER NOT NULL DEFAULT 0,
  accessed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_federation_audit_workspace
  ON federation_access_audit (source_workspace_id, accessed_at DESC);
