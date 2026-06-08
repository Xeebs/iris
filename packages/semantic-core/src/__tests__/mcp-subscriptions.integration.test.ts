import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { MCPSubscriptionManager } from '../mcp-subscriptions.js';

/**
 * Integration tests for MCPSubscriptionManager.
 * Requires Postgres running via docker-compose up -d.
 * Run with: pnpm test:integration
 */

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(connectionString);
});

afterAll(async () => {
  await sql.end();
});

describe('MCPSubscriptionManager integration', () => {
  it('creates and lists subscriptions', async () => {
    const mgr = new MCPSubscriptionManager(sql);
    const sub = await mgr.subscribe({ workspaceId: 'int-test-ws', clientId: 'int-client-1', filters: { entityTypes: ['deal'] } });
    expect(sub.isOk()).toBe(true);

    const list = await mgr.listSubscriptions('int-test-ws');
    expect(list.isOk()).toBe(true);
    const found = list._unsafeUnwrap().find((s) => s.id === sub._unsafeUnwrap().id);
    expect(found).toBeDefined();
    expect(found?.filters.entityTypes).toEqual(['deal']);

    // Cleanup
    await mgr.unsubscribe(sub._unsafeUnwrap().id, 'int-test-ws');
  });
});
