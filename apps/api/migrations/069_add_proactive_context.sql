-- Migration: 069 — Proactive Context Surfacing
-- Stores agent behavioral profiles, suggestions, and tuning settings.

CREATE TABLE IF NOT EXISTS agent_behavior_profiles (
  workspace_id        text NOT NULL,
  agent_id            text NOT NULL,
  entity_types        text[] NOT NULL DEFAULT '{}',
  query_patterns_json jsonb NOT NULL DEFAULT '{}',
  total_queries       int NOT NULL DEFAULT 0,
  learned_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS proactive_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  agent_id        text NOT NULL,
  entity_types    text[] NOT NULL DEFAULT '{}',
  context_hints   text[] NOT NULL DEFAULT '{}',
  score           numeric(5,4) NOT NULL DEFAULT 0,
  accepted        boolean DEFAULT NULL,
  feedback        text CHECK (feedback IN ('accepted', 'ignored', 'modified')) DEFAULT NULL,
  feedback_score  numeric(3,2) DEFAULT NULL,
  feedback_at     timestamptz DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_proactive_settings (
  workspace_id         text NOT NULL,
  agent_id             text NOT NULL,
  aggressiveness       text NOT NULL DEFAULT 'medium' CHECK (aggressiveness IN ('low', 'medium', 'high')),
  enabled_entity_types text[] NOT NULL DEFAULT '{}',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_agent
  ON proactive_suggestions (workspace_id, agent_id, created_at DESC);
