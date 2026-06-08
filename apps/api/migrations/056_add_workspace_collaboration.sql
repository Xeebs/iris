-- Workspace collaboration: team members, resource sharing, and group management
CREATE TABLE IF NOT EXISTS workspace_members (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  user_id         TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'viewer', -- 'admin' | 'editor' | 'viewer'
  invited_by      TEXT,
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_ws
  ON workspace_members (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members (user_id);

-- Granular resource sharing grants
CREATE TABLE IF NOT EXISTS resource_shares (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id        TEXT        NOT NULL,
  resource_type       TEXT        NOT NULL, -- 'connector' | 'glossary' | 'metric' | 'workflow'
  resource_id         TEXT        NOT NULL,
  shared_with_user_id TEXT        NOT NULL,
  permission          TEXT        NOT NULL DEFAULT 'read', -- 'read' | 'write'
  granted_by          TEXT,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, resource_type, resource_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_shares_ws_user
  ON resource_shares (workspace_id, shared_with_user_id);

CREATE INDEX IF NOT EXISTS idx_resource_shares_resource
  ON resource_shares (resource_type, resource_id);

-- Team groups for bulk permission assignment
CREATE TABLE IF NOT EXISTS team_groups (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  group_name      TEXT        NOT NULL,
  member_ids      TEXT[]      NOT NULL DEFAULT '{}',
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, group_name)
);

CREATE INDEX IF NOT EXISTS idx_team_groups_ws
  ON team_groups (workspace_id);
