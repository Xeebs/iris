-- Migration 095: GraphQL Query Audit Log

CREATE TABLE graphql_query_audit (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      TEXT      NOT NULL,
  operation_name    TEXT,
  query_hash        TEXT      NOT NULL,
  query_cost_tokens INT       NOT NULL DEFAULT 0,
  execution_time_ms INT       NOT NULL DEFAULT 0,
  error             TEXT,
  user_id           TEXT,
  accessed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graphql_audit_workspace ON graphql_query_audit(workspace_id, accessed_at DESC);
CREATE INDEX idx_graphql_audit_hash ON graphql_query_audit(query_hash);
CREATE INDEX idx_graphql_audit_user ON graphql_query_audit(workspace_id, user_id);
