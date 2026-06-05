-- Tracks BullMQ sync job history per connector instance.
-- Allows monitoring job progress and auditing sync history without hitting Redis.

CREATE TABLE IF NOT EXISTS sync_jobs (
  id                    TEXT        PRIMARY KEY,
  connector_instance_id TEXT        NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
  workspace_id          TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'queued'
                                    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  triggered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_connector_instance
  ON sync_jobs(connector_instance_id);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_workspace_triggered
  ON sync_jobs(workspace_id, triggered_at DESC);
