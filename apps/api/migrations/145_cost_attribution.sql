-- Migration 145: Advanced Cost Attribution & Per-Entity Chargeback Model
-- Tracks token consumption and compute costs at entity, connector, and user granularity.

CREATE TABLE IF NOT EXISTS entity_cost_attribution (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id     TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  tokens_used  INT NOT NULL DEFAULT 0,
  compute_ms   INT NOT NULL DEFAULT 0,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_cost_attribution_entity_idx ON entity_cost_attribution (entity_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS entity_cost_attribution_query_idx ON entity_cost_attribution (query_id);

CREATE TABLE IF NOT EXISTS connector_cost_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id     TEXT NOT NULL,
  api_call_count   INT NOT NULL DEFAULT 0,
  tokens_indexed   INT NOT NULL DEFAULT 0,
  tokens_retrieved INT NOT NULL DEFAULT 0,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS connector_cost_events_connector_idx ON connector_cost_events (connector_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS user_cost_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  query_id     TEXT NOT NULL,
  connector_id TEXT,
  tokens_used  INT NOT NULL DEFAULT 0,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_cost_ledger_user_idx ON user_cost_ledger (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS user_cost_ledger_connector_idx ON user_cost_ledger (user_id, connector_id);

CREATE TABLE IF NOT EXISTS cost_forecasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           TEXT NOT NULL,
  interval            TEXT NOT NULL,
  forecasted_tokens   INT NOT NULL,
  forecasted_cost_usd NUMERIC(10, 6) NOT NULL,
  confidence_level    TEXT NOT NULL,
  based_on_days       INT NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cost_forecasts_entity_idx ON cost_forecasts (entity_id, computed_at DESC);
