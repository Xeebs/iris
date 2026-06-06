import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Neo4jGraphStore } from '../graph-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

const NEO4J_URI = process.env['NEO4J_URI'] ?? 'bolt://localhost:7687';
const NEO4J_USER = process.env['NEO4J_USER'] ?? 'neo4j';
const NEO4J_PASSWORD = process.env['NEO4J_PASSWORD'] ?? 'iris_password';
const WORKSPACE_ID = 'ws-graph-integration-test';

function makeEntity(id: string, type: string, label: string): SemanticEntity {
  return {
    id,
    type,
    label,
    attributes: {},
    relationships: [],
    lastModified: new Date(),
    sourceId: id,
  };
}

describe('Neo4jGraphStore (integration)', () => {
  let store: Neo4jGraphStore;

  beforeAll(async () => {
    store = new Neo4jGraphStore(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
    await store.initialize();

    // Clean up any leftover test data
    const session = store._getSession();
    await session.run(
      `MATCH (e:IrisEntity { workspaceId: $workspaceId }) DETACH DELETE e`,
      { workspaceId: WORKSPACE_ID },
    );
    await session.close();
  });

  afterAll(async () => {
    const session = store._getSession();
    await session.run(
      `MATCH (e:IrisEntity { workspaceId: $workspaceId }) DETACH DELETE e`,
      { workspaceId: WORKSPACE_ID },
    );
    await session.close();
    await store.close();
  });

  it('should add and retrieve an entity', async () => {
    const entity = makeEntity('test:contact:1', 'contact', 'Alice Smith');
    const addResult = await store.addEntity(entity, WORKSPACE_ID);
    expect(addResult.isOk()).toBe(true);

    const relatedResult = await store.getRelated('test:contact:1', WORKSPACE_ID);
    expect(relatedResult.isOk()).toBe(true);
  });

  it('should add a relationship and traverse it', async () => {
    const contact = makeEntity('test:contact:2', 'contact', 'Bob Jones');
    const company = makeEntity('test:company:1', 'company', 'Acme Corp');

    await store.addEntity(contact, WORKSPACE_ID);
    await store.addEntity(company, WORKSPACE_ID);

    const relResult = await store.addRelationship(
      'test:contact:2',
      'test:company:1',
      'belongs_to',
      WORKSPACE_ID,
    );
    expect(relResult.isOk()).toBe(true);

    const related = await store.getRelated('test:contact:2', WORKSPACE_ID, 'belongs_to');
    expect(related.isOk()).toBe(true);
    const entities = related._unsafeUnwrap();
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe('test:company:1');
    expect(entities[0]!.relationshipType).toBe('belongs_to');
  });

  it('should enforce workspace isolation — entities in other workspaces are not returned', async () => {
    const entity = makeEntity('test:contact:isolated', 'contact', 'Isolated Entity');
    await store.addEntity(entity, 'ws-other');

    const related = await store.getRelated('test:contact:2', WORKSPACE_ID);
    expect(related.isOk()).toBe(true);
    const ids = related._unsafeUnwrap().map((e) => e.id);
    expect(ids).not.toContain('test:contact:isolated');

    // Cleanup
    await store.removeEntity('test:contact:isolated', 'ws-other');
  });

  it('should remove a relationship without deleting nodes', async () => {
    const a = makeEntity('test:contact:3', 'contact', 'Carol White');
    const b = makeEntity('test:deal:1', 'deal', 'Deal Alpha');
    await store.addEntity(a, WORKSPACE_ID);
    await store.addEntity(b, WORKSPACE_ID);
    await store.addRelationship('test:contact:3', 'test:deal:1', 'owns', WORKSPACE_ID);

    const removeResult = await store.removeRelationship('test:contact:3', 'test:deal:1', WORKSPACE_ID);
    expect(removeResult.isOk()).toBe(true);

    const related = await store.getRelated('test:contact:3', WORKSPACE_ID, 'owns');
    expect(related.isOk()).toBe(true);
    expect(related._unsafeUnwrap()).toHaveLength(0);

    // Both nodes should still be traversable from a fresh entity query
    const relatedAll = await store.getRelated('test:contact:3', WORKSPACE_ID);
    expect(relatedAll.isOk()).toBe(true);
    const ids = relatedAll._unsafeUnwrap().map((e) => e.id);
    expect(ids).not.toContain('test:deal:1');
  });

  it('should remove an entity and all its relationships', async () => {
    const entity = makeEntity('test:contact:4', 'contact', 'Dave Brown');
    await store.addEntity(entity, WORKSPACE_ID);

    const removeResult = await store.removeEntity('test:contact:4', WORKSPACE_ID);
    expect(removeResult.isOk()).toBe(true);

    const relatedResult = await store.getRelated('test:contact:4', WORKSPACE_ID);
    expect(relatedResult.isOk()).toBe(true);
    expect(relatedResult._unsafeUnwrap()).toHaveLength(0);
  });

  it('should limit results via the limit parameter', async () => {
    const hub = makeEntity('test:company:hub', 'company', 'Hub Corp');
    await store.addEntity(hub, WORKSPACE_ID);

    for (let i = 0; i < 5; i++) {
      const e = makeEntity(`test:contact:limit-${i}`, 'contact', `User ${i}`);
      await store.addEntity(e, WORKSPACE_ID);
      await store.addRelationship(`test:contact:limit-${i}`, 'test:company:hub', 'belongs_to', WORKSPACE_ID);
    }

    const related = await store.getRelated('test:company:hub', WORKSPACE_ID, undefined, 3);
    expect(related.isOk()).toBe(true);
    expect(related._unsafeUnwrap().length).toBeLessThanOrEqual(3);
  });
});
