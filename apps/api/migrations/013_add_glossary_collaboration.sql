-- Glossary collaboration: term approvals, version history, and usage tracking.

-- Tracks the full history of definition changes for auditing and rollback.
CREATE TABLE IF NOT EXISTS glossary_term_history (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  term_id       TEXT        NOT NULL REFERENCES glossary_terms(id) ON DELETE CASCADE,
  workspace_id  TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  term          TEXT        NOT NULL,
  definition    TEXT        NOT NULL,
  example_value TEXT,
  changed_by    TEXT        NOT NULL DEFAULT 'system',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_glossary_term_history_term
  ON glossary_term_history(term_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_glossary_term_history_workspace
  ON glossary_term_history(workspace_id, changed_at DESC);

-- Approval status for each glossary term.
-- Pending terms are visible but flagged as unverified in context responses.
ALTER TABLE glossary_terms
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CONSTRAINT glossary_terms_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Per-term usage count: how many indexed entities reference this term.
-- Updated asynchronously by the indexer when it detects term mentions.
ALTER TABLE glossary_terms
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_glossary_terms_status
  ON glossary_terms(workspace_id, status);
