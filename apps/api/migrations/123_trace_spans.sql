-- Migration 123: Distributed trace spans storage (OpenTelemetry-compatible fallback)

CREATE TABLE IF NOT EXISTS trace_spans (
  id            BIGSERIAL   PRIMARY KEY,
  trace_id      TEXT        NOT NULL,   -- 32-char hex
  span_id       TEXT        NOT NULL,   -- 16-char hex
  parent_span_id TEXT,                  -- null for root spans
  operation_name TEXT       NOT NULL,
  service_name  TEXT        NOT NULL,
  workspace_id  TEXT        NOT NULL DEFAULT 'default',
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,                -- NULL until span ends
  status        TEXT        NOT NULL DEFAULT 'unset', -- ok | error | unset
  attributes    JSONB       NOT NULL DEFAULT '{}',
  events        JSONB       NOT NULL DEFAULT '[]',
  UNIQUE (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS trace_spans_trace_id ON trace_spans (trace_id);
CREATE INDEX IF NOT EXISTS trace_spans_workspace_started ON trace_spans (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS trace_spans_operation_started ON trace_spans (operation_name, started_at DESC);

COMMENT ON TABLE trace_spans IS
  'Stores OpenTelemetry-compatible span data for distributed tracing. '
  'Primary backend; can coexist with a Jaeger/OTLP exporter.';
