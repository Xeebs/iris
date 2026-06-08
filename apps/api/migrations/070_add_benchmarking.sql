-- Migration: 070 — Cross-company benchmarking
-- Stores anonymized workspace metrics for peer comparison.

CREATE TABLE IF NOT EXISTS workspace_benchmarks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_hash text NOT NULL,
  cohort         text NOT NULL,
  metric_type    text NOT NULL,
  value          numeric(12, 4) NOT NULL,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  percentile_rank numeric(5, 2) DEFAULT NULL,
  industry       text DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS workspace_benchmark_settings (
  workspace_id         text PRIMARY KEY,
  benchmarking_enabled boolean NOT NULL DEFAULT false,
  industry             text DEFAULT NULL,
  company_size         text CHECK (company_size IN ('startup', 'smb', 'midmarket', 'enterprise')) DEFAULT NULL,
  opted_in_at          timestamptz DEFAULT NULL,
  opted_out_at         timestamptz DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_benchmarks_cohort_metric
  ON workspace_benchmarks (cohort, metric_type, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_benchmarks_hash
  ON workspace_benchmarks (workspace_hash);
