CREATE TABLE IF NOT EXISTS billing_tiers (
  tier_name TEXT PRIMARY KEY CHECK (tier_name IN ('starter', 'growth', 'enterprise')),
  monthly_base_cents INT NOT NULL DEFAULT 0,
  entity_index_price_cents INT NOT NULL DEFAULT 0,
  query_price_cents INT NOT NULL DEFAULT 0,
  included_tokens BIGINT NOT NULL DEFAULT 0
);

INSERT INTO billing_tiers (tier_name, monthly_base_cents, entity_index_price_cents, query_price_cents, included_tokens)
VALUES
  ('starter',    0,     0,   0,   500000),
  ('growth',     4900,  1,   5,   5000000),
  ('enterprise', 19900, 0,   2,   50000000)
ON CONFLICT (tier_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_billing (
  workspace_id TEXT PRIMARY KEY,
  tier_name TEXT NOT NULL DEFAULT 'starter' REFERENCES billing_tiers(tier_name),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('entity_indexed', 'query_executed', 'token_spent', 'api_call')),
  quantity BIGINT NOT NULL DEFAULT 1,
  unit_price_cents INT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_charges_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'invoiced', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_workspace ON usage_events (workspace_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events (workspace_id, event_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_periods_workspace ON billing_periods (workspace_id, period_start DESC);
