-- Workspace benchmarking: opt-in metrics collection for peer comparison.

CREATE TABLE IF NOT EXISTS workspace_benchmarking_settings (
  workspace_id        TEXT        PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  benchmarking_enabled BOOLEAN    NOT NULL DEFAULT false,
  industry            TEXT,
  company_size        TEXT        CHECK (company_size IN ('startup', 'smb', 'midmarket', 'enterprise')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_benchmark_snapshots (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id    TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_count    BIGINT      NOT NULL DEFAULT 0,
  query_count     BIGINT      NOT NULL DEFAULT 0,
  avg_context_size_tokens NUMERIC(10,2) NOT NULL DEFAULT 0,
  token_savings_ratio     NUMERIC(5,4) NOT NULL DEFAULT 0,
  cache_hit_rate          NUMERIC(5,4) NOT NULL DEFAULT 0,
  snapshotted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT snapshot_rate CHECK (token_savings_ratio BETWEEN 0 AND 1),
  CONSTRAINT cache_hit_check CHECK (cache_hit_rate BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_workspace_time
  ON workspace_benchmark_snapshots(workspace_id, snapshotted_at DESC);

-- Aggregated peer data (hashed workspace_id for anonymisation)
CREATE TABLE IF NOT EXISTS benchmark_peer_data (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_hash  TEXT        NOT NULL,
  industry        TEXT,
  company_size    TEXT,
  entity_count    BIGINT      NOT NULL,
  query_count     BIGINT      NOT NULL,
  token_savings_ratio NUMERIC(5,4) NOT NULL,
  cache_hit_rate      NUMERIC(5,4) NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peer_data_lookup
  ON benchmark_peer_data(industry, company_size, submitted_at DESC);
