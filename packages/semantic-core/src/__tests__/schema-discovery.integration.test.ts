/**
 * Integration tests for SchemaDiscoveryEngine.
 * Requires Postgres (docker-compose up -d).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { SchemaDiscoveryEngine } from '../schema-discovery.js';

const CONNECTOR_ID = 'integration-test-discovery';
let sql: ReturnType<typeof postgres>;
let engine: SchemaDiscoveryEngine;

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

beforeAll(async () => {
  const url = process.env['DATABASE_URL'] ?? 'postgres://iris:iris@localhost:5432/iris_test';
  sql = postgres(url);
  engine = new SchemaDiscoveryEngine(sql as unknown as SqlFn);

  await sql`DELETE FROM entity_type_suggestions WHERE connector_id = ${CONNECTOR_ID}`.catch(() => {});
  await sql`DELETE FROM relationship_suggestions WHERE connector_id = ${CONNECTOR_ID}`.catch(() => {});
  await sql`DELETE FROM iris_entities WHERE source_id LIKE ${CONNECTOR_ID + ':%'}`.catch(() => {});

  // Seed HubSpot-like entities
  const entities = [
    // 100 contacts
    ...Array.from({ length: 100 }, (_, i) => ({
      entity_id: `${CONNECTOR_ID}:contact:c-${i}`,
      entity_type: 'contact',
      label: `Contact ${i}`,
      attrs: { email: `c${i}@corp.com`, name: `Contact ${i}`, company_id: `comp-${i % 10}` },
    })),
    // 20 companies
    ...Array.from({ length: 20 }, (_, i) => ({
      entity_id: `${CONNECTOR_ID}:company:comp-${i}`,
      entity_type: 'company',
      label: `Company ${i}`,
      attrs: { name: `Company ${i}`, industry: 'SaaS', arr: 100000 + i * 10000 },
    })),
    // 5 deals
    ...Array.from({ length: 5 }, (_, i) => ({
      entity_id: `${CONNECTOR_ID}:deal:d-${i}`,
      entity_type: 'deal',
      label: `Deal ${i}`,
      attrs: { title: `Deal ${i}`, amount: 50000, contact_id: `c-${i}` },
    })),
  ];

  for (const e of entities) {
    await sql`
      INSERT INTO iris_entities (id, workspace_id, type, label, source_id, attributes, last_modified)
      VALUES (${e.entity_id}, 'test-ws', ${e.entity_type}, ${e.label},
              ${CONNECTOR_ID + ':' + e.entity_type + ':' + e.entity_id.split(':').at(-1)},
              ${sql.json(e.attrs)}, NOW())
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  }
});

afterAll(async () => {
  await sql`DELETE FROM entity_type_suggestions WHERE connector_id = ${CONNECTOR_ID}`.catch(() => {});
  await sql`DELETE FROM relationship_suggestions WHERE connector_id = ${CONNECTOR_ID}`.catch(() => {});
  await sql`DELETE FROM iris_entities WHERE source_id LIKE ${CONNECTOR_ID + ':%'}`.catch(() => {});
  await sql.end();
});

describe('SchemaDiscoveryEngine integration', () => {
  it('detects all 3 entity types from seeded entities', async () => {
    const result = await engine.detectEntityTypes(CONNECTOR_ID);
    expect(result.isOk()).toBe(true);
    const types = result._unsafeUnwrap().map(t => t.entityType);
    expect(types).toContain('contact');
    expect(types).toContain('company');
    expect(types).toContain('deal');
  });

  it('contact entity type has high confidence (100 samples)', async () => {
    const result = await engine.detectEntityTypes(CONNECTOR_ID);
    const contact = result._unsafeUnwrap().find(t => t.entityType === 'contact');
    expect(contact?.confidence).toBe('high');
  });

  it('runDiscovery persists suggestions to DB', async () => {
    const result = await engine.runDiscovery(CONNECTOR_ID);
    expect(result.isOk()).toBe(true);
    const rows = await sql`
      SELECT * FROM entity_type_suggestions WHERE connector_id = ${CONNECTOR_ID}
    ` as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('listSuggestions returns stored entity types', async () => {
    const result = await engine.listSuggestions(CONNECTOR_ID);
    expect(result.isOk()).toBe(true);
    const { entityTypes } = result._unsafeUnwrap();
    expect(entityTypes.length).toBeGreaterThanOrEqual(3);
  });

  it('confirms entity type suggestion', async () => {
    const listResult = await engine.listSuggestions(CONNECTOR_ID);
    const { entityTypes } = listResult._unsafeUnwrap();
    const first = entityTypes[0];
    if (first?.suggestionId) {
      const confirmResult = await engine.confirmSuggestion(first.suggestionId, 'entity_type_suggestions');
      expect(confirmResult.isOk()).toBe(true);
      const reread = await engine.listSuggestions(CONNECTOR_ID);
      const confirmed = reread._unsafeUnwrap().entityTypes.find(e => e.suggestionId === first.suggestionId);
      expect(confirmed?.confirmed).toBe(true);
    }
  });

  it('relationship suggestions include contact → company (via company_id)', async () => {
    const result = await engine.listSuggestions(CONNECTOR_ID);
    const { relationships } = result._unsafeUnwrap();
    const contactToCompany = relationships.find(
      r => r.fromEntityType === 'contact' && r.toEntityType === 'company'
    );
    expect(contactToCompany).toBeDefined();
    expect(contactToCompany?.heuristic).toBe('fk_pattern');
  });

  it('generateMappingReport returns coverage score ≥ 0.9', async () => {
    const result = await engine.generateMappingReport(CONNECTOR_ID);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.coverageScore).toBeGreaterThanOrEqual(0.9);
    expect(report.totalEntities).toBeGreaterThan(0);
  });
});
