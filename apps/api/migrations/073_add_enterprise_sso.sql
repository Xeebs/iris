-- Migration: 073 — Enterprise SSO (SAML 2.0 & OIDC)
-- Stores SSO provider configurations and provisioned user identities.

CREATE TABLE IF NOT EXISTS sso_configurations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            text NOT NULL,
  provider                text NOT NULL CHECK (provider IN ('saml', 'oidc')),
  provider_name           text NOT NULL,
  enabled                 boolean NOT NULL DEFAULT false,
  metadata_url            text DEFAULT NULL,
  entity_id               text DEFAULT NULL,
  acs_url                 text DEFAULT NULL,
  issuer                  text DEFAULT NULL,
  client_id               text DEFAULT NULL,
  client_secret_encrypted text DEFAULT NULL,
  signing_cert            text DEFAULT NULL,
  attribute_mappings_json jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS sso_users (
  user_id            text NOT NULL,
  workspace_id       text NOT NULL,
  external_id        text NOT NULL,
  external_email     text NOT NULL,
  sso_provider       text NOT NULL,
  synced_groups_json jsonb NOT NULL DEFAULT '[]',
  last_sync_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_configurations_workspace
  ON sso_configurations (workspace_id, enabled);

CREATE INDEX IF NOT EXISTS idx_sso_users_workspace_email
  ON sso_users (workspace_id, external_email);
