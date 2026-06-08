-- Migration 126: SLO monitoring definitions, events, and violations

CREATE TABLE IF NOT EXISTS slo_definitions (
  name            TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  metric          TEXT        NOT NULL,
  target          DOUBLE PRECISION NOT NULL,
  window_hours    INTEGER     NOT NULL DEFAULT 24,
  severity        TEXT        NOT NULL DEFAULT 'warning',  -- warning | critical
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (name, workspace_id)
);

CREATE TABLE IF NOT EXISTS slo_events (
  id              BIGSERIAL   PRIMARY KEY,
  slo_name        TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  metric_value    DOUBLE PRECISION NOT NULL,
  met             BOOLEAN     NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slo_events_name_time
  ON slo_events (slo_name, workspace_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS slo_violations (
  id              BIGSERIAL   PRIMARY KEY,
  slo_name        TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  attainment_pct  DOUBLE PRECISION NOT NULL,
  target_pct      DOUBLE PRECISION NOT NULL,
  severity        TEXT        NOT NULL,
  corrective_hint TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS slo_violations_name_time
  ON slo_violations (slo_name, workspace_id, started_at DESC);

COMMENT ON TABLE slo_definitions IS
  'SLO definitions per workspace. Built-in SLOs seeded at workspace creation.';
