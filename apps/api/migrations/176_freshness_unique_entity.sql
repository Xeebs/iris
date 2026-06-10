-- FreshnessTracker upserts with ON CONFLICT (entity_id), but migration 148
-- only created a non-unique index on entity_id — every insert failed with
-- 42P10 (no matching unique constraint) and the service swallowed it into an
-- err Result. Dedup any accumulated rows, then add the unique index the
-- upsert requires.

DELETE FROM entity_freshness_tracking a
USING entity_freshness_tracking b
WHERE a.entity_id = b.entity_id AND a.id < b.id;

DROP INDEX IF EXISTS idx_eft_entity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eft_entity_unique
  ON entity_freshness_tracking (entity_id);
