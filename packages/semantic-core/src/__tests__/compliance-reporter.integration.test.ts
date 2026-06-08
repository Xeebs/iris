import { describe, it } from 'vitest';

describe('ComplianceReporter integration', () => {
  it.skip('records events and generates GDPR report against real DB', () => {
    // Requires: docker-compose up -d (Postgres with compliance_events, anomaly_alerts tables)
    // Run with: pnpm test:integration --filter=@iris/semantic-core
  });
});
