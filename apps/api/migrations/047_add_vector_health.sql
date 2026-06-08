-- Stores results of periodic vector index health checks per workspace.
-- Each row is one health check run; queried to show trends over time.

CREATE TABLE IF NOT EXISTS vector_health_checks (
  id               BIGSERIAL     PRIMARY KEY,
  workspace_id     TEXT          NOT NULL,
  check_timestamp  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  drift_score      DOUBLE PRECISION NOT NULL DEFAULT 0,
  outlier_count    INTEGER       NOT NULL DEFAULT 0,
  consistency_score DOUBLE PRECISION NOT NULL DEFAULT 1,
  report_json      JSONB         NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_vector_health_workspace_ts
  ON vector_health_checks (workspace_id, check_timestamp DESC);
