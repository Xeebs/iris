-- Migration 094: Compliance Audit Export & Anomaly Detection Tables

CREATE TABLE signed_audit_exports (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT      NOT NULL,
  export_id       TEXT      NOT NULL UNIQUE,
  start_date      TIMESTAMPTZ NOT NULL,
  end_date        TIMESTAMPTZ NOT NULL,
  signature       TEXT      NOT NULL,
  public_key      TEXT      NOT NULL,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by_user_id TEXT NOT NULL,
  tamper_check_status  TEXT NOT NULL DEFAULT 'valid' CHECK (tamper_check_status IN ('valid', 'tampered', 'unknown')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signed_audit_exports_workspace ON signed_audit_exports(workspace_id, signed_at DESC);
CREATE INDEX idx_signed_audit_exports_export_id ON signed_audit_exports(export_id);

CREATE TABLE anomalous_access_alerts (
  id                   BIGSERIAL PRIMARY KEY,
  workspace_id         TEXT      NOT NULL,
  alert_type           TEXT      NOT NULL CHECK (alert_type IN ('bulk_access', 'off_hours', 'pii_overaccess')),
  user_id              TEXT      NOT NULL,
  entity_ids_involved  JSONB     NOT NULL DEFAULT '[]',
  confidence           DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  flagged_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details              TEXT,
  resolved             BOOLEAN   NOT NULL DEFAULT FALSE,
  resolved_at          TIMESTAMPTZ,
  resolved_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anomalous_alerts_workspace ON anomalous_access_alerts(workspace_id, flagged_at DESC);
CREATE INDEX idx_anomalous_alerts_user ON anomalous_access_alerts(workspace_id, user_id);
CREATE INDEX idx_anomalous_alerts_type ON anomalous_access_alerts(workspace_id, alert_type);
CREATE INDEX idx_anomalous_alerts_unresolved ON anomalous_access_alerts(workspace_id) WHERE resolved = FALSE;
