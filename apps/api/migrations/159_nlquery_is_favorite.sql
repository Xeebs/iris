-- Migration 159: Add is_favorite column to nlquery_sessions for bookmarking

ALTER TABLE nlquery_sessions
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_nlquery_sessions_favorite
  ON nlquery_sessions (workspace_id, is_favorite) WHERE is_favorite = true;
