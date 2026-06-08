/**
 * Integration tests for ConnectorMarketplaceService.
 * Requires a real Postgres instance (docker-compose up -d).
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { ConnectorMarketplaceService } from '../connector-marketplace.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test';

let sql: ReturnType<typeof postgres>;
let svc: ConnectorMarketplaceService;

beforeAll(async () => {
  sql = postgres(DB_URL);
  svc = new ConnectorMarketplaceService(sql as ConstructorParameters<typeof ConnectorMarketplaceService>[0]);

  // Seed a test listing
  await sql`
    INSERT INTO connector_listings (connector_id, name, description, category, is_official, is_published)
    VALUES ('test-integration-connector', 'Test Connector', 'Integration test connector', 'test', false, true)
    ON CONFLICT (connector_id) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM connector_listings WHERE connector_id = 'test-integration-connector'`;
  await sql.end();
});

describe('ConnectorMarketplaceService (integration)', () => {
  it('retrieves published listings from real DB', async () => {
    const result = await svc.getListings({ category: 'test' });
    expect(result.isOk()).toBe(true);
    const { listings } = result._unsafeUnwrap();
    const entry = listings.find(l => l.connectorId === 'test-integration-connector');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Test Connector');
  });

  it('records an install for a workspace', async () => {
    const result = await svc.installConnector('ws-integration-test', 'test-integration-connector');
    expect(result.isOk()).toBe(true);
  });

  it('submits and curates a connector', async () => {
    const submitResult = await svc.submitConnector({
      connectorId: 'test-integration-connector',
      name: 'Test Connector Updated',
      description: 'Updated in integration test',
      version: '1.1.0',
    });
    expect(submitResult.isOk()).toBe(true);
    expect(submitResult._unsafeUnwrap().version).toBe('1.1.0');

    const curateResult = await svc.curateListing('test-integration-connector', true);
    expect(curateResult.isOk()).toBe(true);
  });

  it('records and retrieves a rating', async () => {
    const rateResult = await svc.rateConnector('test-integration-connector', 'user-integration', 4, 'Works well');
    expect(rateResult.isOk()).toBe(true);
    expect(rateResult._unsafeUnwrap().rating).toBe(4);

    const ratingsResult = await svc.getRatings('test-integration-connector');
    expect(ratingsResult.isOk()).toBe(true);
    const { reviews, avgRating } = ratingsResult._unsafeUnwrap();
    expect(reviews.length).toBeGreaterThan(0);
    expect(avgRating).toBeGreaterThan(0);
  });
});
