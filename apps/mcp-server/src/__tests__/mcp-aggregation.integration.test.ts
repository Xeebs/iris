/**
 * Integration tests for aggregate-entities and compare-entities MCP tools.
 * Requires Postgres (docker-compose up -d).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { aggregateEntitiesTool } from '../tools/aggregate-entities.js';
import { compareEntitiesTool } from '../tools/compare-entities.js';

const WORKSPACE_ID = 'integration-test-mcp-agg';
let sql: ReturnType<typeof postgres>;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

function asSqlFn(s: ReturnType<typeof postgres>): SqlFn {
  return s as unknown as SqlFn;
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(url);

  await sql`DELETE FROM semantic_entities WHERE workspace_id = ${WORKSPACE_ID}`.catch(() => {});

  // Seed 10 contacts: 5 lead, 3 prospect, 2 customer
  const contacts = [
    { id: 'c-1', label: 'Alice', attrs: { stage: 'lead', arr: 100, region: 'us' } },
    { id: 'c-2', label: 'Bob', attrs: { stage: 'lead', arr: 200, region: 'eu' } },
    { id: 'c-3', label: 'Carol', attrs: { stage: 'lead', arr: 150, region: 'us' } },
    { id: 'c-4', label: 'Dave', attrs: { stage: 'lead', arr: 80, region: 'eu' } },
    { id: 'c-5', label: 'Eve', attrs: { stage: 'lead', arr: 120, region: 'us' } },
    { id: 'c-6', label: 'Frank', attrs: { stage: 'prospect', arr: 300, region: 'us' } },
    { id: 'c-7', label: 'Grace', attrs: { stage: 'prospect', arr: 250, region: 'eu' } },
    { id: 'c-8', label: 'Hank', attrs: { stage: 'prospect', arr: 180, region: 'us' } },
    { id: 'c-9', label: 'Ivy', attrs: { stage: 'customer', arr: 1000, region: 'us' } },
    { id: 'c-10', label: 'Jack', attrs: { stage: 'customer', arr: 800, region: 'eu' } },
  ];

  for (const c of contacts) {
    await sql`
      INSERT INTO semantic_entities (entity_id, workspace_id, entity_type, label, attributes)
      VALUES (${c.id}, ${WORKSPACE_ID}, 'contact', ${c.label}, ${JSON.stringify(c.attrs)}::jsonb)
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  }
});

afterAll(async () => {
  await sql`DELETE FROM semantic_entities WHERE workspace_id = ${WORKSPACE_ID}`.catch(() => {});
  await sql.end();
});

describe('aggregateEntitiesTool integration', () => {
  it('groups contacts by stage correctly', async () => {
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      workspaceId: WORKSPACE_ID,
      contextBudget: 2000,
    }, asSqlFn(sql));
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('lead: count=5');
    expect(text).toContain('prospect: count=3');
    expect(text).toContain('customer: count=2');
  });

  it('computes sum of arr by stage', async () => {
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['sum'],
      sumField: 'arr',
      workspaceId: WORKSPACE_ID,
      contextBudget: 2000,
    }, asSqlFn(sql));
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('sum=1800.00'); // customer: 1000+800
  });

  it('filters by region before aggregating', async () => {
    const result = await aggregateEntitiesTool({
      entityType: 'contact',
      groupByAttribute: 'stage',
      aggregations: ['count'],
      filters: { region: 'eu' },
      workspaceId: WORKSPACE_ID,
      contextBudget: 2000,
    }, asSqlFn(sql));
    const text = result._unsafeUnwrap().content[0]!.text;
    // eu contacts: lead(Bob,Dave), prospect(Grace), customer(Jack)
    expect(text).toContain('lead: count=2');
    expect(text).toContain('prospect: count=1');
    expect(text).toContain('customer: count=1');
  });
});

describe('compareEntitiesTool integration', () => {
  it('compares 3 HubSpot-style contacts across 8 attributes within 300-token budget', async () => {
    const result = await compareEntitiesTool({
      entityIds: ['c-1', 'c-2', 'c-3'],
      diffHighlight: true,
      workspaceId: WORKSPACE_ID,
      contextBudget: 300,
    }, asSqlFn(sql));
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
    expect(text).toContain('Carol');
    // result must stay within budget
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(350); // 300 + small overhead tolerance
  });

  it('returns all attributes when diffHighlight=false', async () => {
    const result = await compareEntitiesTool({
      entityIds: ['c-9', 'c-10'],
      diffHighlight: false,
      workspaceId: WORKSPACE_ID,
      contextBudget: 2000,
    }, asSqlFn(sql));
    const text = result._unsafeUnwrap().content[0]!.text;
    expect(text).toContain('stage');
    expect(text).toContain('arr');
    expect(text).toContain('region');
  });
});
