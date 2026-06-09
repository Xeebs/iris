-- Migration 167: Connector health forecasts and proactive alerts

CREATE TABLE IF NOT EXISTS health_forecasts (
  forecast_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  forecast_date DATE NOT NULL,
  forecasted_score NUMERIC NOT NULL,
  confidence_interval_low NUMERIC NOT NULL,
  confidence_interval_high NUMERIC NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'exponential_smoothing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, workspace_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_forecasts_connector ON health_forecasts (connector_id, workspace_id, forecast_date);

CREATE TABLE IF NOT EXISTS forecast_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  alert_severity TEXT NOT NULL CHECK (alert_severity IN ('warning', 'critical')),
  predicted_issue TEXT NOT NULL CHECK (predicted_issue IN ('high_latency', 'high_error_rate', 'data_staleness', 'health_decline')),
  days_until_threshold INTEGER NOT NULL DEFAULT 0,
  current_score NUMERIC,
  predicted_score NUMERIC,
  recommended_action TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecast_alerts_connector ON forecast_alerts (connector_id, workspace_id, created_at DESC);
