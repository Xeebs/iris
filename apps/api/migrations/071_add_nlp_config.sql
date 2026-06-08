-- NLP intent configuration: stores natural language config requests
-- All intents require user confirmation (applied_at = NULL until confirmed)
CREATE TABLE IF NOT EXISTS nlp_intents (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           text        NOT NULL,
  category               text        NOT NULL CHECK (category IN ('temporal', 'retention', 'access_control', 'entity_merging')),
  natural_text           text        NOT NULL,
  interpreted_config_json jsonb      NOT NULL,
  confirmed_by_user_id   text,
  applied_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlp_intents_workspace ON nlp_intents (workspace_id, applied_at);

-- Track rollback snapshots for applied intents
CREATE TABLE IF NOT EXISTS nlp_intent_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id     uuid        NOT NULL REFERENCES nlp_intents(id) ON DELETE CASCADE,
  workspace_id  text        NOT NULL,
  before_json   jsonb,
  after_json    jsonb       NOT NULL,
  reverted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
