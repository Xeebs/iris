import { describe, it, expect, vi, beforeEach } from 'vitest';
import neo4j from 'neo4j-driver';

import { Neo4jGraphStore } from '../graph-store.js';
import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'hubspot:contact:1',
    type: 'contact',
    label: 'Alice Smith',
    attributes: { email: 'alice@example.com' },
    relationships: [],
    lastModified: new Date('2026-01-01T00:00:00Z'),
    sourceId: 'hubspot:contact:1',
    ...overrides,
  };
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeSessionMock(records: Record<string, unknown>[] = []) {
  const run = vi.fn().mockResolvedValue({ records: records.map((r) => ({ get: (k: string) => r[k] })) });
  const close = vi.fn().mockResolvedValue(undefined);
  return { run, close };
}

function makeDriverMock(sessionMock: ReturnType<typeof makeSessionMock>) {
  return {
    session: vi.fn().mockReturnValue(sessionMock),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Neo4jGraphStore', () => {
  let store: Neo4jGraphStore;
  let sessionMock: ReturnType<typeof makeSessionMock>;

  beforeEach(() => {
    sessionMock = makeSessionMock();
    const driverMock = makeDriverMock(sessionMock);

    // Patch neo4j.driver to return our mock
    vi.spyOn(neo4j, 'driver').mockReturnValue(driverMock as unknown as ReturnType<typeof neo4j.driver>);
    vi.spyOn(neo4j, 'auth', 'get').mockReturnValue({ basic: vi.fn().mockReturnValue({}) } as unknown as typeof neo4j.auth);

    store = new Neo4jGraphStore('bolt://localhost:7687', 'neo4j', 'password');
    // Inject the mock driver directly via the session factory
    (store as unknown as { driver: typeof driverMock }).driver = driverMock;
  });

  describe('addEntity', () => {
    it('runs a MERGE query with entity id, workspaceId, type, and label', async () => {
      const entity = makeEntity();
      const result = await store.addEntity(entity, 'ws-1');

      expect(result.isOk()).toBe(true);
      expect(sessionMock.run).toHaveBeenCalledOnce();
      const [query, params] = sessionMock.run.mock.calls[0] as [string, Record<string, unknown>];
      expect(query).toMatch(/MERGE.*IrisEntity/);
      expect(params['id']).toBe(entity.id);
      expect(params['workspaceId']).toBe('ws-1');
      expect(params['type']).toBe(entity.type);
      expect(params['label']).toBe(entity.label);
      expect(sessionMock.close).toHaveBeenCalledOnce();
    });

    it('returns err when the Neo4j session throws', async () => {
      sessionMock.run.mockRejectedValueOnce(new Error('connection refused'));
      const result = await store.addEntity(makeEntity(), 'ws-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/connection refused/);
    });
  });

  describe('addRelationship', () => {
    it('runs a MERGE query linking two entities by workspaceId', async () => {
      const result = await store.addRelationship(
        'hubspot:contact:1',
        'hubspot:company:99',
        'belongs_to',
        'ws-1',
      );

      expect(result.isOk()).toBe(true);
      const [query, params] = sessionMock.run.mock.calls[0] as [string, Record<string, unknown>];
      expect(query).toMatch(/MERGE.*IRIS_REL/);
      expect(params['sourceId']).toBe('hubspot:contact:1');
      expect(params['targetId']).toBe('hubspot:company:99');
      expect(params['type']).toBe('belongs_to');
      expect(params['workspaceId']).toBe('ws-1');
    });

    it('returns err when session throws', async () => {
      sessionMock.run.mockRejectedValueOnce(new Error('write error'));
      const result = await store.addRelationship('a', 'b', 'owns', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getRelated', () => {
    it('returns related entities from query records', async () => {
      const relatedSession = makeSessionMock([
        { id: 'hubspot:company:99', type: 'company', label: 'Acme Corp', relType: 'belongs_to' },
      ]);
      const driver2 = makeDriverMock(relatedSession);
      (store as unknown as { driver: typeof driver2 }).driver = driver2;

      const result = await store.getRelated('hubspot:contact:1', 'ws-1', 'belongs_to', 10);

      expect(result.isOk()).toBe(true);
      const related = result._unsafeUnwrap();
      expect(related).toHaveLength(1);
      expect(related[0]!.id).toBe('hubspot:company:99');
      expect(related[0]!.relationshipType).toBe('belongs_to');
      expect(related[0]!.workspaceId).toBe('ws-1');
    });

    it('returns an empty array when no related entities exist', async () => {
      const result = await store.getRelated('hubspot:contact:1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('uses default limit of 25 when not specified', async () => {
      await store.getRelated('hubspot:contact:1', 'ws-1');
      const [, params] = sessionMock.run.mock.calls[0] as [string, Record<string, unknown>];
      expect(neo4j.integer.toNumber(params['limit'] as ReturnType<typeof neo4j.int>)).toBe(25);
    });

    it('returns err when session throws', async () => {
      sessionMock.run.mockRejectedValueOnce(new Error('read error'));
      const result = await store.getRelated('id', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('removeEntity', () => {
    it('runs DETACH DELETE for the entity', async () => {
      const result = await store.removeEntity('hubspot:contact:1', 'ws-1');

      expect(result.isOk()).toBe(true);
      const [query, params] = sessionMock.run.mock.calls[0] as [string, Record<string, unknown>];
      expect(query).toMatch(/DETACH DELETE/);
      expect(params['entityId']).toBe('hubspot:contact:1');
      expect(params['workspaceId']).toBe('ws-1');
    });

    it('returns err when session throws', async () => {
      sessionMock.run.mockRejectedValueOnce(new Error('delete error'));
      const result = await store.removeEntity('id', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('removeRelationship', () => {
    it('deletes only the relationship, not the nodes', async () => {
      const result = await store.removeRelationship('a', 'b', 'ws-1');

      expect(result.isOk()).toBe(true);
      const [query, params] = sessionMock.run.mock.calls[0] as [string, Record<string, unknown>];
      expect(query).toMatch(/DELETE r/);
      expect(query).not.toMatch(/DETACH DELETE/);
      expect(params['sourceId']).toBe('a');
      expect(params['targetId']).toBe('b');
    });

    it('returns err when session throws', async () => {
      sessionMock.run.mockRejectedValueOnce(new Error('rel delete error'));
      const result = await store.removeRelationship('a', 'b', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('close', () => {
    it('closes the driver', async () => {
      const driverSpy = vi.fn().mockResolvedValue(undefined);
      (store as unknown as { driver: { close: typeof driverSpy } }).driver = { close: driverSpy };
      await store.close();
      expect(driverSpy).toHaveBeenCalledOnce();
    });
  });
});
