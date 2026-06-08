-- Migration 084: Schema Auto-Discovery suggestion tables

CREATE TABLE IF NOT EXISTS entity_type_suggestions (
  suggestion_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id    TEXT        NOT NULL,
  entity_type     TEXT        NOT NULL,
  sample_count    INTEGER     NOT NULL DEFAULT 0,
  fields_json     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  confidence      TEXT        NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  confirmed       BOOLEAN     NOT NULL DEFAULT false,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_entity_type_suggestion UNIQUE (connector_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_ets_connector
  ON entity_type_suggestions (connector_id, confirmed);

CREATE TABLE IF NOT EXISTS relationship_suggestions (
  suggestion_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id       TEXT        NOT NULL,
  from_entity_type   TEXT        NOT NULL,
  to_entity_type     TEXT        NOT NULL,
  via_field          TEXT        NOT NULL,
  relationship_type  TEXT        NOT NULL CHECK (relationship_type IN ('belongs_to', 'has_many', 'references')),
  confidence         TEXT        NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  heuristic          TEXT        NOT NULL CHECK (heuristic IN ('fk_pattern', 'id_suffix', 'name_similarity')),
  confirmed          BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_relationship_suggestion UNIQUE (connector_id, from_entity_type, to_entity_type, via_field)
);

CREATE INDEX IF NOT EXISTS idx_rel_suggestions_connector
  ON relationship_suggestions (connector_id, confidence);
