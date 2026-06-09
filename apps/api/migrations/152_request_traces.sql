-- Migration 152: Distributed request tracing with W3C TraceContext

CREATE TABLE IF NOT EXISTS request_traces (
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  operation_name  TEXT NOT NULL,
  service_name    TEXT NOT NULL DEFAULT 'api',
  duration_ms     NUMERIC(10,3),
  status          TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'timeout')),
  metadata        JSONB NOT NULL DEFAULT '{}',
  errors          JSONB,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  workspace_id    TEXT,
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_request_traces_trace_id
  ON request_traces (trace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_traces_operation
  ON request_traces (operation_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_traces_workspace
  ON request_traces (workspace_id, started_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_request_traces_started_at
  ON request_traces (started_at DESC);
