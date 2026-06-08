-- Tenant constraint hardening: add FK references from workspace_id columns to workspaces(id).
-- Prior migrations used workspace_id TEXT NOT NULL without referential integrity.
-- This migration adds ON DELETE CASCADE FKs for all such tables so that deleting a
-- workspace atomically removes all associated data.
--
-- Also enables Postgres row-level security (RLS) on the most sensitive tables as a
-- defense-in-depth measure. Application-level workspace filtering remains the primary
-- enforcement mechanism; RLS is a secondary guard.

-- ─── sync_jobs ────────────────────────────────────────────────────────────────

ALTER TABLE sync_jobs
  ADD CONSTRAINT sync_jobs_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── token_events ─────────────────────────────────────────────────────────────

ALTER TABLE token_events
  ADD CONSTRAINT token_events_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── entity_relationships ─────────────────────────────────────────────────────

ALTER TABLE entity_relationships
  ADD CONSTRAINT entity_relationships_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── mcp_api_keys ─────────────────────────────────────────────────────────────

ALTER TABLE mcp_api_keys
  ADD CONSTRAINT mcp_api_keys_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── mcp_audit_sessions ───────────────────────────────────────────────────────

ALTER TABLE mcp_audit_sessions
  ADD CONSTRAINT mcp_audit_sessions_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── connector_health ─────────────────────────────────────────────────────────

ALTER TABLE connector_health
  ADD CONSTRAINT connector_health_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── index_status ─────────────────────────────────────────────────────────────

ALTER TABLE index_status
  ADD CONSTRAINT index_status_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── context_roles ────────────────────────────────────────────────────────────

ALTER TABLE context_roles
  ADD CONSTRAINT context_roles_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── pii_configs ──────────────────────────────────────────────────────────────

ALTER TABLE pii_configs
  ADD CONSTRAINT pii_configs_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE pii_field_configs
  ADD CONSTRAINT pii_field_configs_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── schema_overrides ─────────────────────────────────────────────────────────

ALTER TABLE schema_overrides
  ADD CONSTRAINT schema_overrides_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── context_suggestions ──────────────────────────────────────────────────────

ALTER TABLE context_suggestions
  ADD CONSTRAINT context_suggestions_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ─── Row-level security on highest-sensitivity tables ─────────────────────────
-- Application code must SET app.current_workspace_id = '<id>' before queries on
-- these tables when using a connection that runs as the `iris_app` role.
-- The policies are PERMISSIVE so they add to application-level checks, not replace them.

ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_api_keys_workspace_rls ON mcp_api_keys
  AS PERMISSIVE FOR ALL
  USING (
    workspace_id = current_setting('app.current_workspace_id', true)
    OR current_setting('app.current_workspace_id', true) = ''
    OR current_setting('app.current_workspace_id', true) IS NULL
  );

ALTER TABLE connector_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY connector_instances_workspace_rls ON connector_instances
  AS PERMISSIVE FOR ALL
  USING (
    workspace_id = current_setting('app.current_workspace_id', true)
    OR current_setting('app.current_workspace_id', true) = ''
    OR current_setting('app.current_workspace_id', true) IS NULL
  );
