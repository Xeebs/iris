-- Migration 141: business rule engine and data validation

CREATE TABLE IF NOT EXISTS business_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  conditions  JSONB NOT NULL DEFAULT '[]',
  action      TEXT NOT NULL DEFAULT 'warn' CHECK (action IN ('reject','warn','log')),
  severity    TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('error','warning','info')),
  description TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rule_violations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             UUID NOT NULL REFERENCES business_rules(id) ON DELETE CASCADE,
  entity_id           TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  violated_condition  JSONB NOT NULL,
  correction_suggestion TEXT,
  severity            TEXT NOT NULL CHECK (severity IN ('error','warning','info')),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rule_corrections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      UUID NOT NULL REFERENCES business_rules(id) ON DELETE CASCADE,
  entity_id    TEXT NOT NULL,
  field        TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  applied      BOOLEAN NOT NULL DEFAULT false,
  trust_level  TEXT NOT NULL DEFAULT 'safe',
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS violation_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        UUID NOT NULL REFERENCES business_rules(id) ON DELETE CASCADE,
  window_key     TEXT NOT NULL,
  violation_count INTEGER NOT NULL DEFAULT 0,
  entity_type    TEXT NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, window_key)
);

CREATE INDEX IF NOT EXISTS idx_business_rules_entity_type ON business_rules(entity_type, active);
CREATE INDEX IF NOT EXISTS idx_rule_violations_rule_id ON rule_violations(rule_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_violations_entity ON rule_violations(entity_id);
