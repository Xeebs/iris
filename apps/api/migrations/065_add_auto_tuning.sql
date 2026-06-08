CREATE TABLE IF NOT EXISTS auto_tuning_recommendations (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    TEXT NOT NULL,
  type                            TEXT NOT NULL,
  title                           TEXT NOT NULL,
  description                     TEXT NOT NULL,
  estimated_monthly_savings_cents INTEGER NOT NULL DEFAULT 0,
  estimated_quality_impact_pct    NUMERIC(5, 2) NOT NULL DEFAULT 0,
  status                          TEXT NOT NULL DEFAULT 'pending',
  ab_test_id                      UUID,
  feedback_helpful                BOOLEAN,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_tuning_workspace
  ON auto_tuning_recommendations (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS auto_tuning_ab_tests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id   UUID NOT NULL REFERENCES auto_tuning_recommendations(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'running',
  control_metric      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  treatment_metric    NUMERIC(10, 4) NOT NULL DEFAULT 0,
  conclusion_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
