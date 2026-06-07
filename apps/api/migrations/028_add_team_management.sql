CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  invite_status TEXT NOT NULL DEFAULT 'active' CHECK (invite_status IN ('active', 'pending', 'removed')),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_workspace_members_unique
  ON workspace_members(workspace_id, user_id)
  WHERE invite_status != 'removed';

CREATE INDEX idx_workspace_members_workspace
  ON workspace_members(workspace_id, invite_status);

CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  invited_by TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_invitations_workspace
  ON team_invitations(workspace_id, expires_at);
CREATE INDEX idx_team_invitations_token
  ON team_invitations(token)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
