-- Tracks per-workspace attribute value frequency to filter non-discriminative terms from embeddings.
-- Inspired by SIRA: attributes shared by >60% of same-type entities carry no discriminative signal.

CREATE TABLE IF NOT EXISTS entity_attribute_frequency (
  id                BIGSERIAL        PRIMARY KEY,
  workspace_id      TEXT             NOT NULL,
  entity_type       TEXT             NOT NULL,
  attr_key          TEXT             NOT NULL,
  attr_value_hash   TEXT             NOT NULL,
  occurrence_count  INTEGER          NOT NULL DEFAULT 0,
  total_entities    INTEGER          NOT NULL DEFAULT 0,
  frequency_ratio   DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_type, attr_key, attr_value_hash)
);

CREATE INDEX IF NOT EXISTS idx_attr_freq_workspace_type
  ON entity_attribute_frequency (workspace_id, entity_type, attr_key);
