import { describe, it } from 'vitest';

describe.skip('DataLineageService integration', () => {
  it('records entity origin and retrieves lineage', async () => {
    // requires docker-compose services (postgres with pgvector)
    // run with: pnpm test:integration --filter @iris/semantic-core
  });

  it('lists lineage records with cursor pagination', async () => {
    // requires docker-compose services
  });

  it('handles batch origin recording', async () => {
    // requires docker-compose services
  });
});
