-- Migration 156: Resilience circuit breaker state persistence

CREATE TABLE IF NOT EXISTS resilience_circuit_breaker_state (
  service             TEXT PRIMARY KEY,
  failure_count       INTEGER NOT NULL DEFAULT 0,
  last_failure_time   TIMESTAMPTZ,
  state               TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half-open')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_state ON resilience_circuit_breaker_state (state);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_circuit_breaker_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_circuit_breaker_updated_at ON resilience_circuit_breaker_state;
CREATE TRIGGER set_circuit_breaker_updated_at
  BEFORE UPDATE ON resilience_circuit_breaker_state
  FOR EACH ROW EXECUTE FUNCTION update_circuit_breaker_updated_at();
