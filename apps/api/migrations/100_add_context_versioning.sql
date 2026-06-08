-- Context versioning: point-in-time snapshots and version diffs

CREATE TABLE IF NOT EXISTS context_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  snapshot_key    TEXT NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_size_bytes BIGINT NOT NULL DEFAULT 0,
  gzip_size_bytes BIGINT NOT NULL DEFAULT 0,
  entity_count    INTEGER NOT NULL DEFAULT 0,
  checksum        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_workspace_date
  ON context_snapshots (workspace_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS version_diffs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        TEXT NOT NULL,
  from_version_id     UUID NOT NULL,
  to_version_id       UUID NOT NULL,
  changed_entity_ids  JSONB NOT NULL DEFAULT '[]',
  change_types        JSONB NOT NULL DEFAULT '[]',
  diff_summary        JSONB NOT NULL DEFAULT '{}',
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, from_version_id, to_version_id)
);

CREATE INDEX IF NOT EXISTS idx_version_diffs_workspace
  ON version_diffs (workspace_id, from_version_id, to_version_id);
