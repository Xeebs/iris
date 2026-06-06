-- Adds configurable sync frequency to connector instances.
-- sync_frequency: how often the connector should sync.
-- sync_schedule_cron: custom cron expression (required when frequency = 'custom').
-- sync_start_time: preferred start time for daily/weekly schedules (HH:MM format, UTC).

ALTER TABLE connector_instances
  ADD COLUMN IF NOT EXISTS sync_frequency TEXT NOT NULL DEFAULT 'manual'
    CONSTRAINT connector_instances_sync_frequency_check
    CHECK (sync_frequency IN ('real-time', 'hourly', 'daily', 'weekly', 'manual', 'custom')),
  ADD COLUMN IF NOT EXISTS sync_schedule_cron TEXT,
  ADD COLUMN IF NOT EXISTS sync_start_time TEXT;

COMMENT ON COLUMN connector_instances.sync_frequency IS
  'Sync cadence: real-time (webhook), hourly, daily, weekly, manual (on-demand), custom (cron expression)';
COMMENT ON COLUMN connector_instances.sync_schedule_cron IS
  'Custom cron expression in POSIX format — required when sync_frequency = ''custom''';
COMMENT ON COLUMN connector_instances.sync_start_time IS
  'Preferred start time for daily/weekly schedules. Format: HH:MM UTC. Example: ''09:00''';
