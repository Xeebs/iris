import { describe, it } from 'vitest';

describe.skip('ProactiveContextEngine integration', () => {
  it('records query events and builds behavioral profile', async () => {
    // requires docker-compose services (postgres)
    // run with: pnpm test:integration --filter @iris/semantic-core
  });

  it('generates proactive suggestions after enough queries', async () => {
    // requires docker-compose services
  });

  it('records feedback and updates acceptance stats', async () => {
    // requires docker-compose services
  });
});
