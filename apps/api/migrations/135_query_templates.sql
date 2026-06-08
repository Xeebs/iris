-- Migration 135: query templates, parameters, and usage tracking

CREATE TABLE IF NOT EXISTS query_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  query        TEXT NOT NULL,
  parameters   JSONB NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  tags         JSONB NOT NULL DEFAULT '[]',
  visibility   TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private','workspace','public')),
  workspace_id UUID NOT NULL,
  created_by   TEXT NOT NULL,
  usage_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES query_templates(id) ON DELETE CASCADE,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latency_ms  INTEGER,
  cache_hit   BOOLEAN
);

CREATE TABLE IF NOT EXISTS template_suggestions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES query_templates(id) ON DELETE CASCADE,
  suggestion   TEXT NOT NULL,
  impact_level TEXT NOT NULL CHECK (impact_level IN ('low','medium','high')),
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_templates_workspace_id ON query_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_query_templates_visibility ON query_templates(visibility);
CREATE INDEX IF NOT EXISTS idx_query_templates_name ON query_templates(name);
CREATE INDEX IF NOT EXISTS idx_template_usage_template_id ON template_usage(template_id, used_at DESC);
