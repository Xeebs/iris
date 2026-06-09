-- Migration 174: Data quality scan jobs and per-entity issue tracking

CREATE TABLE IF NOT EXISTS data_quality_scans (
  scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_entities INTEGER NOT NULL DEFAULT 0,
  issues_found INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_dq_scans_workspace ON data_quality_scans (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dq_scans_connector ON data_quality_scans (connector_id, started_at DESC);

CREATE TABLE IF NOT EXISTS data_quality_issues (
  issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES data_quality_scans(scan_id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('required_field_missing', 'type_mismatch', 'invalid_format', 'outlier')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  field_name TEXT,
  expected_type TEXT,
  actual_value TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dq_issues_scan ON data_quality_issues (scan_id, severity);
CREATE INDEX IF NOT EXISTS idx_dq_issues_entity ON data_quality_issues (entity_id, issue_type);
CREATE INDEX IF NOT EXISTS idx_dq_issues_unresolved ON data_quality_issues (scan_id) WHERE resolved_at IS NULL;
