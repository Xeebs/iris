-- Migration 096: SCIM 2.0 User Provisioning & Group Mappings

CREATE TABLE scim_provisioned_users (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      TEXT      NOT NULL,
  user_id           TEXT      NOT NULL,
  external_user_id  TEXT      NOT NULL,
  directory_type    TEXT      NOT NULL DEFAULT 'generic' CHECK (directory_type IN ('azure_ad', 'okta', 'google_workspace', 'generic')),
  user_name         TEXT      NOT NULL,
  display_name      TEXT      NOT NULL DEFAULT '',
  email             TEXT      NOT NULL DEFAULT '',
  active            BOOLEAN   NOT NULL DEFAULT TRUE,
  iris_role         TEXT      NOT NULL DEFAULT 'viewer',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, external_user_id)
);

CREATE INDEX idx_scim_users_workspace ON scim_provisioned_users(workspace_id);
CREATE INDEX idx_scim_users_user_id ON scim_provisioned_users(workspace_id, user_id);
CREATE INDEX idx_scim_users_active ON scim_provisioned_users(workspace_id) WHERE active = TRUE;

CREATE TABLE scim_group_mappings (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      TEXT      NOT NULL,
  group_name        TEXT      NOT NULL,
  external_group_id TEXT      NOT NULL,
  iris_role         TEXT      NOT NULL DEFAULT 'viewer',
  directory_type    TEXT      NOT NULL DEFAULT 'generic',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, group_name)
);

CREATE INDEX idx_scim_groups_workspace ON scim_group_mappings(workspace_id);
