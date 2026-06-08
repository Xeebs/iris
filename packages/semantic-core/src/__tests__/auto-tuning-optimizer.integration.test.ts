import { describe, it } from 'vitest';

describe('AutoTuningOptimizer integration', () => {
  it.skip('runs recommendation generation against real DB', () => {
    // Requires: docker-compose up -d (Postgres with mcp_query_audit and indexed_entities tables)
    // Run with: pnpm test:integration --filter=@iris/semantic-core
  });
});
