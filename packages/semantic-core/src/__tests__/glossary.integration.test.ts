/**
 * Integration tests for GlossaryService — require real Postgres.
 * Run with: pnpm test:integration (after docker-compose up -d)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { GlossaryService } from '../glossary.js';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris_test';

describe.skipIf(!process.env['INTEGRATION'])('GlossaryService — integration', () => {
  let sql: ReturnType<typeof postgres>;
  let service: GlossaryService;
  const workspaceId = `test-ws-${Date.now()}`;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL);
    await sql`
      INSERT INTO workspaces (id, name) VALUES (${workspaceId}, 'Test Workspace')
      ON CONFLICT DO NOTHING
    `;
    service = new GlossaryService(sql);
  });

  afterAll(async () => {
    await sql`DELETE FROM glossary_terms WHERE workspace_id = ${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql.end();
  });

  it('adds, retrieves, and deletes a term', async () => {
    const addResult = await service.addTerm(workspaceId, 'ARR', 'Annual Recurring Revenue', '$1.2M');
    expect(addResult.isOk()).toBe(true);

    const getResult = await service.getTerm(workspaceId, 'ARR');
    expect(getResult.isOk()).toBe(true);
    expect(getResult._unsafeUnwrap()?.definition).toBe('Annual Recurring Revenue');

    const deleteResult = await service.deleteTerm(workspaceId, 'ARR');
    expect(deleteResult.isOk()).toBe(true);
    expect(deleteResult._unsafeUnwrap()).toBe(true);

    const notFound = await service.getTerm(workspaceId, 'ARR');
    expect(notFound._unsafeUnwrap()).toBeNull();
  });

  it('upserts on duplicate term', async () => {
    await service.addTerm(workspaceId, 'MRR', 'Monthly Recurring Revenue');
    const updated = await service.addTerm(workspaceId, 'MRR', 'Monthly Recurring Revenue — updated');
    expect(updated._unsafeUnwrap()?.definition).toContain('updated');
    await service.deleteTerm(workspaceId, 'MRR');
  });

  it('lists all terms for workspace', async () => {
    await service.addTerm(workspaceId, 'CAC', 'Customer Acquisition Cost');
    await service.addTerm(workspaceId, 'LTV', 'Lifetime Value');

    const listResult = await service.listTerms(workspaceId);
    expect(listResult.isOk()).toBe(true);
    expect(listResult._unsafeUnwrap().length).toBeGreaterThanOrEqual(2);

    await service.deleteTerm(workspaceId, 'CAC');
    await service.deleteTerm(workspaceId, 'LTV');
  });
});
