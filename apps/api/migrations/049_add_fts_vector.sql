-- Add full-text search vector column to support BM25 lexical retrieval.
-- Populated by a trigger on insert/update from entity label + type + attributes.

ALTER TABLE iris_entities ADD COLUMN IF NOT EXISTS fts_vector tsvector;

CREATE OR REPLACE FUNCTION iris_entities_fts_trigger_fn() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english',
    coalesce(NEW.label, '') || ' ' || coalesce(NEW.entity_type, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iris_entities_fts_trigger ON iris_entities;

CREATE TRIGGER iris_entities_fts_trigger
  BEFORE INSERT OR UPDATE OF label, entity_type ON iris_entities
  FOR EACH ROW EXECUTE FUNCTION iris_entities_fts_trigger_fn();

CREATE INDEX IF NOT EXISTS idx_iris_entities_fts
  ON iris_entities USING GIN (fts_vector);

-- Backfill existing rows (runs once; idempotent on re-run)
UPDATE iris_entities
SET fts_vector = to_tsvector('english', coalesce(label, '') || ' ' || coalesce(entity_type, ''))
WHERE fts_vector IS NULL;
