CREATE TABLE IF NOT EXISTS connector_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  icon_url TEXT,
  documentation_url TEXT,
  author TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  is_official BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  popularity_score REAL NOT NULL DEFAULT 0,
  workspace_installs_count INT NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES connector_listings(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS connector_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES connector_listings(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_published ON connector_listings (is_published, popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_category ON connector_listings (category, is_published);
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON connector_reviews (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_installs_workspace ON connector_installs (workspace_id);
