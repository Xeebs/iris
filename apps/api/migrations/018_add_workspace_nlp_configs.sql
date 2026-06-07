-- Natural language workspace configuration storage.
-- Workspace admins can describe business rules in plain English; the NLP parser
-- interprets them and stores structured JSON for downstream services to use.

CREATE TABLE IF NOT EXISTS workspace_nlp_configs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_type    TEXT        NOT NULL
                             CHECK (config_type IN ('fiscal_calendar', 'metric_definition', 'date_interpretation', 'custom')),
  input_text     TEXT        NOT NULL,
  parsed_json    JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  interpreted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlp_configs_workspace
  ON workspace_nlp_configs(workspace_id, config_type, interpreted_at DESC);

CREATE INDEX IF NOT EXISTS idx_nlp_configs_status
  ON workspace_nlp_configs(workspace_id, status);
