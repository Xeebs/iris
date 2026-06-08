-- Migration 079: Multi-tenant workspace cost attribution and query count tracking

CREATE TABLE IF NOT EXISTS workspace_cost_attribution (
  id             BIGSERIAL    PRIMARY KEY,
  workspace_id   UUID         NOT NULL,
  date           DATE         NOT NULL,
  cost_category  TEXT         NOT NULL
    CHECK (cost_category IN ('embeddings', 'queries', 'storage', 'cache_miss')),
  amount_cents   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  metadata_json  JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_attr_workspace_date
  ON workspace_cost_attribution(workspace_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_cost_attr_category
  ON workspace_cost_attribution(workspace_id, cost_category, date DESC);

CREATE TABLE IF NOT EXISTS workspace_query_counts (
  id             BIGSERIAL  PRIMARY KEY,
  workspace_id   UUID       NOT NULL,
  date           DATE       NOT NULL,
  query_type     TEXT       NOT NULL
    CHECK (query_type IN ('vector_search', 'graph_expansion', 'compression')),
  count          INTEGER    NOT NULL DEFAULT 0,
  avg_latency_ms NUMERIC(10, 2),
  UNIQUE (workspace_id, date, query_type)
);

CREATE INDEX IF NOT EXISTS idx_query_counts_workspace_date
  ON workspace_query_counts(workspace_id, date DESC);
