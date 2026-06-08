-- Query learning: observed query patterns and missing context candidates.

CREATE TABLE IF NOT EXISTS query_patterns (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT          NOT NULL,
  query_hash            TEXT          NOT NULL,
  entity_types_queried  JSONB         NOT NULL DEFAULT '[]',
  filters_used          JSONB         NOT NULL DEFAULT '{}',
  avg_result_size       INTEGER       NOT NULL DEFAULT 0,
  success_rate          NUMERIC(4,3)  NOT NULL DEFAULT 1.0,
  occurrences           INTEGER       NOT NULL DEFAULT 1,
  similar_queries       JSONB,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT query_patterns_uq UNIQUE (workspace_id, query_hash)
);

CREATE INDEX IF NOT EXISTS qp_workspace_idx        ON query_patterns (workspace_id, occurrences DESC);
CREATE INDEX IF NOT EXISTS qp_entity_types_idx     ON query_patterns USING GIN (entity_types_queried);

CREATE TABLE IF NOT EXISTS missing_context_candidates (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT          NOT NULL,
  entity_type           TEXT          NOT NULL,
  attribute             TEXT          NOT NULL,
  suggestion_confidence NUMERIC(4,3)  NOT NULL DEFAULT 0.5,
  use_case              TEXT          NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT missing_context_uq UNIQUE (workspace_id, entity_type, attribute)
);

CREATE INDEX IF NOT EXISTS mcc_workspace_type_idx  ON missing_context_candidates (workspace_id, entity_type);
