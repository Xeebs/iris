-- Several services (index-repair, index-analytics, entity-validator,
-- index-maintenance) were written against tables named indexed_entities and
-- entity_vectors that never existed — the canonical entity store is
-- iris_entities (048a), with embeddings inline. Provide compatibility views
-- so those read/delete paths work against the real store.
--
-- New code should query iris_entities directly; these views exist to keep
-- the legacy names working. Both are simple single-table views, so DELETE
-- through them (index-maintenance pruning) is auto-updatable by Postgres.

DROP VIEW IF EXISTS indexed_entities;
CREATE VIEW indexed_entities AS
SELECT
  id,
  workspace_id,
  type,
  type AS entity_type,
  label,
  attributes,
  relationships,
  last_modified,
  source_id,
  split_part(source_id, ':', 1) AS source_connector_id,
  embedding,
  indexed_at
FROM iris_entities;

DROP VIEW IF EXISTS entity_vectors;
CREATE VIEW entity_vectors AS
SELECT
  id AS entity_id,
  workspace_id,
  embedding
FROM iris_entities
WHERE embedding IS NOT NULL;
