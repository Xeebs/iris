-- Migration 125: circuit breaker state persistence for connector graceful degradation

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  connector_id        TEXT        NOT NULL,
  workspace_id        TEXT        NOT NULL,
  state               TEXT        NOT NULL DEFAULT 'closed',  -- closed | open | half_open
  fail_count          INTEGER     NOT NULL DEFAULT 0,
  success_count       INTEGER     NOT NULL DEFAULT 0,
  last_failure_at     TIMESTAMPTZ,
  opened_at           TIMESTAMPTZ,
  half_open_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connector_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS circuit_breaker_events (
  id              BIGSERIAL   PRIMARY KEY,
  connector_id    TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,  -- attempt_success | attempt_failure | state_opened | state_half_opened | state_closed | manual_reset
  latency_ms      INTEGER,
  error_code      TEXT,
  previous_state  TEXT,
  new_state       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS circuit_breaker_events_connector_time
  ON circuit_breaker_events (connector_id, workspace_id, occurred_at DESC);

COMMENT ON TABLE circuit_breaker_state IS
  'Persisted circuit breaker state per connector+workspace. Prevents cascading failures.';
