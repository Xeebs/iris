-- Migration 131: granular permission management
-- Tables for fine-grained RBAC: permissions, role_permissions, permission_audit, context_roles
-- context_roles may already exist from 012_add_context_permissions.sql without user_id.
ALTER TABLE context_roles ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE TABLE IF NOT EXISTS permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  resource     TEXT NOT NULL CHECK (resource IN ('entities','connectors','queries','metrics','workspaces','users')),
  action       TEXT NOT NULL CHECK (action IN ('read','write','admin','delete')),
  conditions   JSONB,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         UUID NOT NULL,
  permission_name TEXT NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by      TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_name)
);

CREATE TABLE IF NOT EXISTS context_roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by  TEXT NOT NULL,
  UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permission_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID NOT NULL,
  permission_name TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('granted','revoked')),
  actor           TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context         JSONB
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_context_roles_user_id ON context_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_context_roles_workspace_id ON context_roles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_permission_audit_role_id ON permission_audit(role_id);
CREATE INDEX IF NOT EXISTS idx_permission_audit_occurred_at ON permission_audit(occurred_at DESC);

-- Seed built-in permissions
INSERT INTO permissions (id, name, resource, action, description) VALUES
  (gen_random_uuid(), 'read:entities',   'entities',   'read',  'Read entity records'),
  (gen_random_uuid(), 'write:entities',  'entities',   'write', 'Create and update entity records'),
  (gen_random_uuid(), 'delete:entities', 'entities',   'delete','Delete entity records'),
  (gen_random_uuid(), 'read:connectors', 'connectors', 'read',  'View connector configurations'),
  (gen_random_uuid(), 'write:connectors','connectors', 'write', 'Create and update connectors'),
  (gen_random_uuid(), 'admin:connectors','connectors', 'admin', 'Full connector administration'),
  (gen_random_uuid(), 'read:queries',    'queries',    'read',  'View saved queries'),
  (gen_random_uuid(), 'write:queries',   'queries',    'write', 'Create and update queries'),
  (gen_random_uuid(), 'read:metrics',    'metrics',    'read',  'View metrics and reports'),
  (gen_random_uuid(), 'write:metrics',   'metrics',    'write', 'Create and update metrics'),
  (gen_random_uuid(), 'read:users',      'users',      'read',  'View user accounts'),
  (gen_random_uuid(), 'write:users',     'users',      'write', 'Create and update users'),
  (gen_random_uuid(), 'admin:workspaces','workspaces', 'admin', 'Full workspace administration — grants all permissions')
ON CONFLICT (name) DO NOTHING;
