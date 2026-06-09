-- Migration 166: Data quality scores, issues, and remediation tracking

CREATE TABLE IF NOT EXISTS data_quality_scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  completeness_score NUMERIC NOT NULL DEFAULT 0,
  freshness_score NUMERIC NOT NULL DEFAULT 0,
  accuracy_score NUMERIC NOT NULL DEFAULT 0,
  overall_score NUMERIC NOT NULL DEFAULT 0,
  last_assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_dq_scores_workspace ON data_quality_scores (workspace_id, entity_type);

CREATE TABLE IF NOT EXISTS quality_issues (
  issue_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('duplicates', 'stale', 'invalid', 'missing_relationship')),
  entity_type TEXT NOT NULL,
  affected_count INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  description TEXT,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  auto_resolved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_quality_issues_workspace ON quality_issues (workspace_id, severity, first_detected_at DESC);

CREATE TABLE IF NOT EXISTS remediation_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL REFERENCES quality_issues(issue_id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_impact TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'applied')) DEFAULT 'pending',
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remediation_issue ON remediation_actions (issue_id, status);
