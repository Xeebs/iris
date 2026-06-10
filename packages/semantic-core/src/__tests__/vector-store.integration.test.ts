import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgvectorStore } from '../vector-store.js';
import { createDefaultProvider } from '../embedding-provider.js';
import type { SemanticEntity } from '@iris/connector-sdk';

const DATABASE_URL = process.env['DATABASE_URL'];

const DIMENSIONS = createDefaultProvider().getModelDimensions();

function makeEntity(id: string, type = 'contact'): SemanticEntity {
  return {
    id,
    type,
    label: `Entity ${id}`,
    attributes: { company: 'Acme Corp', stage: 'lead' },
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: id,
  };
}

function makeVector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => (i === seed ? 1.0 : 0.0));
}

describe.skipIf(!DATABASE_URL)('PgvectorStore integration', () => {
  let store: PgvectorStore;

  beforeAll(async () => {
    store = new PgvectorStore(DATABASE_URL!, DIMENSIONS);
    await store.initialize();
    await store.delete(['hubspot:contact:it-1', 'hubspot:contact:it-2', 'hubspot:contact:it-3']);
  });

  afterAll(async () => {
    await store.delete(['hubspot:contact:it-1', 'hubspot:contact:it-2', 'hubspot:contact:it-3']);
    await store.close();
  });

  it('upserts entities and retrieves them via search', async () => {
    const entity = makeEntity('hubspot:contact:it-1');
    const vector = makeVector(0);

    await store.upsert([entity], [vector]);

    const results = await store.search(vector, 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.entity.id).toBe('hubspot:contact:it-1');
    expect(results[0]?.score).toBeGreaterThan(0.99);
  });

  it('updates existing entities on upsert conflict', async () => {
    const entity = makeEntity('hubspot:contact:it-1');
    const updated = { ...entity, label: 'Updated Label' };

    await store.upsert([updated], [makeVector(0)]);

    const results = await store.search(makeVector(0), 1);
    expect(results[0]?.entity.label).toBe('Updated Label');
  });

  it('filters search results by entityTypes', async () => {
    const contact = makeEntity('hubspot:contact:it-2', 'contact');
    const company = makeEntity('hubspot:company:it-99', 'company');
    await store.upsert([contact, company], [makeVector(1), makeVector(2)]);

    const results = await store.search(makeVector(1), 5, { entityTypes: ['contact'] });
    expect(results.every((r) => r.entity.type === 'contact')).toBe(true);
  });

  it('deletes entities by ID', async () => {
    const entity = makeEntity('hubspot:contact:it-3');
    await store.upsert([entity], [makeVector(5)]);

    await store.delete(['hubspot:contact:it-3']);

    const results = await store.search(makeVector(5), 5);
    const found = results.some((r) => r.entity.id === 'hubspot:contact:it-3');
    expect(found).toBe(false);
  });

  it('handles empty upsert gracefully', async () => {
    await expect(store.upsert([], [])).resolves.toBeUndefined();
  });

  it('handles empty delete gracefully', async () => {
    await expect(store.delete([])).resolves.toBeUndefined();
  });
});
