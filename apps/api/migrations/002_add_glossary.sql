-- Business terminology dictionary per workspace.

CREATE TABLE IF NOT EXISTS glossary_terms (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id  TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  term          TEXT        NOT NULL,
  definition    TEXT        NOT NULL,
  example_value TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, term)
);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_workspace
  ON glossary_terms(workspace_id);
