-- Migration 128: API version registry and endpoint deprecation tracking

CREATE TABLE IF NOT EXISTS api_versions (
  version         TEXT        PRIMARY KEY,
  status          TEXT        NOT NULL DEFAULT 'active',  -- active | deprecated | sunset
  released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sunset_at       TIMESTAMPTZ,
  features        JSONB       NOT NULL DEFAULT '[]',
  min_client_ver  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS endpoint_versions (
  id              BIGSERIAL   PRIMARY KEY,
  path            TEXT        NOT NULL,
  method          TEXT        NOT NULL DEFAULT 'GET',
  version         TEXT        NOT NULL REFERENCES api_versions(version) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'active',  -- active | deprecated | sunset
  deprecated_at   TIMESTAMPTZ,
  sunset_at       TIMESTAMPTZ,
  migration_path  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (path, method, version)
);

CREATE INDEX IF NOT EXISTS endpoint_versions_version ON endpoint_versions (version);
CREATE INDEX IF NOT EXISTS endpoint_versions_status ON endpoint_versions (status) WHERE status != 'active';

-- Seed known versions
INSERT INTO api_versions (version, status, released_at, features) VALUES
  ('v1', 'deprecated', '2026-01-01', '["entities","search","connectors"]'),
  ('v2', 'active', '2026-06-01', '["entities","search","connectors","streaming","tracing","ha"]')
ON CONFLICT (version) DO NOTHING;

COMMENT ON TABLE api_versions IS 'Registry of all API versions with lifecycle status.';
COMMENT ON TABLE endpoint_versions IS 'Per-endpoint version deprecation and migration tracking.';
