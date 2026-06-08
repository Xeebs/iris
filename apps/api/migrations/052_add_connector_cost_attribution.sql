-- Per-connector cost attribution: tracks indexing and query costs per connector instance
CREATE TABLE IF NOT EXISTS connector_cost_attribution (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id          TEXT        NOT NULL,
  connector_id          TEXT        NOT NULL,
  event_type            TEXT        NOT NULL,  -- 'entity_indexed' | 'query_executed'
  quantity              INTEGER     NOT NULL DEFAULT 1,
  cost_cents            NUMERIC(10,4) NOT NULL DEFAULT 0,
  tokens_spent          INTEGER     NOT NULL DEFAULT 0,
  tokens_saved          INTEGER     NOT NULL DEFAULT 0,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_cost_workspace
  ON connector_cost_attribution (workspace_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_cost_connector
  ON connector_cost_attribution (connector_id, workspace_id, recorded_at DESC);

-- Materialized aggregations for fast dashboard queries
CREATE TABLE IF NOT EXISTS connector_cost_daily (
  workspace_id          TEXT        NOT NULL,
  connector_id          TEXT        NOT NULL,
  date                  DATE        NOT NULL,
  entity_count_indexed  INTEGER     NOT NULL DEFAULT 0,
  index_cost_cents      NUMERIC(10,4) NOT NULL DEFAULT 0,
  query_count           INTEGER     NOT NULL DEFAULT 0,
  query_cost_cents      NUMERIC(10,4) NOT NULL DEFAULT 0,
  tokens_spent          INTEGER     NOT NULL DEFAULT 0,
  tokens_saved          INTEGER     NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, connector_id, date)
);

CREATE INDEX IF NOT EXISTS idx_connector_cost_daily_ws
  ON connector_cost_daily (workspace_id, date DESC);
