-- Migration 060: connector recipes and marketplace

CREATE TABLE IF NOT EXISTS connector_recipes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT        NOT NULL,
  recipe_name  TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'general',
  connectors_config_json JSONB NOT NULL DEFAULT '[]',
  glossary_terms_json    JSONB NOT NULL DEFAULT '[]',
  workflows_json         JSONB NOT NULL DEFAULT '[]',
  author_user_id TEXT    NOT NULL,
  shared       BOOLEAN     NOT NULL DEFAULT false,
  usage_count  INTEGER     NOT NULL DEFAULT 0,
  version      INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_reviews (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   UUID        NOT NULL REFERENCES connector_recipes(id) ON DELETE CASCADE,
  reviewer_id TEXT        NOT NULL,
  rating      INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_recipes_workspace
  ON connector_recipes (workspace_id);

CREATE INDEX IF NOT EXISTS idx_connector_recipes_shared
  ON connector_recipes (shared)
  WHERE shared = true;

CREATE INDEX IF NOT EXISTS idx_connector_recipes_category
  ON connector_recipes (category);

CREATE INDEX IF NOT EXISTS idx_recipe_reviews_recipe_id
  ON recipe_reviews (recipe_id);
