-- Migration 161: Data governance schema (retention policies, compliance metadata, DSR queue)
-- retention_policies was first created in migration 137 with a narrower per-entity-type schema
-- (no workspace_id). Rename it to legacy before creating the workspace-scoped version.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'retention_policies'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retention_policies' AND column_name = 'workspace_id'
  ) THEN
    ALTER TABLE retention_policies RENAME TO retention_policies_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS retention_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  ttl_days INTEGER NOT NULL CHECK (ttl_days > 0),
  applies_to_labels TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connector_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_workspace ON retention_policies (workspace_id);
CREATE INDEX IF NOT EXISTS idx_retention_policies_connector ON retention_policies (connector_id);

CREATE TABLE IF NOT EXISTS compliance_metadata (
  compliance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL UNIQUE,
  gdpr_status TEXT NOT NULL DEFAULT 'not_assessed' CHECK (gdpr_status IN ('compliant','non_compliant','not_assessed','in_progress')),
  hipaa_status TEXT NOT NULL DEFAULT 'not_assessed' CHECK (hipaa_status IN ('compliant','non_compliant','not_assessed','in_progress')),
  soc2_status TEXT NOT NULL DEFAULT 'not_assessed' CHECK (soc2_status IN ('compliant','non_compliant','not_assessed','in_progress')),
  gdpr_cert_expires_at TIMESTAMPTZ,
  hipaa_cert_expires_at TIMESTAMPTZ,
  soc2_cert_expires_at TIMESTAMPTZ,
  last_audit_at TIMESTAMPTZ,
  scope_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dsr_queue (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('deletion','export','rectification','access')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed','cancelled')),
  entity_ids TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_dsr_queue_workspace ON dsr_queue (workspace_id);
CREATE INDEX IF NOT EXISTS idx_dsr_queue_status ON dsr_queue (status);
