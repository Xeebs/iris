/**
 * Integration tests for EntityLinker.
 * Requires Postgres with entity_cross_connector_links and entity_merges tables.
 * Run with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { EntityLinker } from '../entity-linker.js';
import type { LinkProposal } from '../entity-linker.js';

const connectionString = process.env['DATABASE_URL'] ?? 'postgresql://iris:iris@localhost:5432/iris_test';

describe.skip('EntityLinker integration', () => {
  let sql: ReturnType<typeof postgres>;
  let linker: EntityLinker;
  const WS = 'integration-test-entity-linking';

  beforeAll(async () => {
    sql = postgres(connectionString);
    linker = new EntityLinker(sql as unknown as Parameters<typeof EntityLinker>[0]);
  });

  afterAll(async () => {
    await sql`DELETE FROM entity_cross_connector_links WHERE workspace_id = ${WS}`;
    await sql`DELETE FROM entity_merges WHERE workspace_id = ${WS}`;
    await sql.end();
  });

  it('creates and retrieves link proposals', async () => {
    const proposal: LinkProposal = {
      entityIdA: 'hubspot:contact:test-1',
      connectorA: 'hubspot',
      entityIdB: 'salesforce:contact:test-1',
      connectorB: 'salesforce',
      confidence: 0.85,
      matchSignals: { nameSimilarity: 0.9, emailDomainMatch: true, compositeScore: 0.85 },
    };

    const createResult = await linker.createLink(WS, proposal);
    expect(createResult.isOk()).toBe(true);

    const listResult = await linker.listLinks(WS, 'proposed');
    expect(listResult.isOk()).toBe(true);
    expect(listResult._unsafeUnwrap().length).toBeGreaterThanOrEqual(1);
  });

  it('confirms and records a merge', async () => {
    const mergeResult = await linker.confirmMerge(
      'hubspot:contact:test-1',
      'salesforce:contact:test-1',
      WS,
      'test-user',
    );
    expect(mergeResult.isOk()).toBe(true);
    const mergeId = mergeResult._unsafeUnwrap();

    const historyResult = await linker.getMergeHistory(WS);
    expect(historyResult.isOk()).toBe(true);
    const history = historyResult._unsafeUnwrap();
    expect(history.some(m => m.mergeId === mergeId)).toBe(true);
  });

  it('can undo a merge', async () => {
    const mergeResult = await linker.confirmMerge(
      'a:1', 'b:1', WS, 'test-user',
    );
    const mergeId = mergeResult._unsafeUnwrap();

    const undoResult = await linker.undoMerge(mergeId, WS);
    expect(undoResult.isOk()).toBe(true);

    const historyResult = await linker.getMergeHistory(WS);
    const record = historyResult._unsafeUnwrap().find(m => m.mergeId === mergeId);
    expect(record?.undoneAt).toBeDefined();
  });
});
