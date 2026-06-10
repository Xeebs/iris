-- Fix BM25 lexical search: the 049 trigger indexed only label + type (despite its
-- comment promising attributes), so attribute values like a deal's status ("open")
-- or stage ("negotiation") were never lexically searchable. Index attribute string
-- and numeric values as well, and re-fire the trigger when attributes change.

CREATE OR REPLACE FUNCTION iris_entities_fts_trigger_fn() RETURNS trigger AS $$
BEGIN
  NEW.fts_vector :=
    to_tsvector('english', coalesce(NEW.label, '') || ' ' || coalesce(NEW.type, ''))
    || jsonb_to_tsvector('english', coalesce(NEW.attributes, '{}'::jsonb), '["string", "numeric"]');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS iris_entities_fts_trigger ON iris_entities;

CREATE TRIGGER iris_entities_fts_trigger
  BEFORE INSERT OR UPDATE OF label, type, attributes ON iris_entities
  FOR EACH ROW EXECUTE FUNCTION iris_entities_fts_trigger_fn();

-- Backfill existing rows (idempotent on re-run)
UPDATE iris_entities
SET fts_vector =
  to_tsvector('english', coalesce(label, '') || ' ' || coalesce(type, ''))
  || jsonb_to_tsvector('english', coalesce(attributes, '{}'::jsonb), '["string", "numeric"]');
