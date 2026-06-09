-- Migration 140: automated insight generation and scheduled reporting

CREATE TABLE IF NOT EXISTS generated_insights (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    TEXT NOT NULL,
  insight_type   TEXT NOT NULL CHECK (insight_type IN ('anomaly','trend','outlier','missing_data','relationship','pattern')),
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  affected_count INTEGER NOT NULL DEFAULT 0,
  severity       TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  value_score    SMALLINT NOT NULL DEFAULT 0,
  evidence       JSONB NOT NULL DEFAULT '[]',
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insight_value_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id   UUID NOT NULL REFERENCES generated_insights(id) ON DELETE CASCADE,
  was_valuable BOOLEAN NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insight_delivery_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_types JSONB NOT NULL DEFAULT '[]',
  frequency    TEXT NOT NULL CHECK (frequency IN ('daily','weekly')),
  recipients   JSONB NOT NULL DEFAULT '[]',
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insight_metrics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id     UUID NOT NULL REFERENCES generated_insights(id) ON DELETE CASCADE,
  metric_name    TEXT NOT NULL,
  metric_value   NUMERIC NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_insights_entity ON generated_insights(entity_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_insights_value ON generated_insights(value_score DESC);
CREATE INDEX IF NOT EXISTS idx_generated_insights_severity ON generated_insights(severity);
CREATE INDEX IF NOT EXISTS idx_insight_delivery_jobs_next ON insight_delivery_jobs(next_run_at ASC);
