import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { LinearConnector } from '../linear-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import issuesFixture from '../../tests/fixtures/issues.json' assert { type: 'json' };
import projectsFixture from '../../tests/fixtures/projects.json' assert { type: 'json' };

const LINEAR_API = 'https://api.linear.app/graphql';

// Cycle fixture is embedded in projects.json for convenience
const cyclesResponse = {
  data: {
    cycles: {
      nodes: projectsFixture.data.cycles.nodes,
      pageInfo: projectsFixture.data.cycles.pageInfo,
    },
  },
};

const projectsResponse = {
  data: {
    projects: {
      nodes: projectsFixture.data.projects.nodes,
      pageInfo: projectsFixture.data.projects.pageInfo,
    },
  },
};

// Track which query is being made to route correctly
function makeHandler(callCount = { n: 0 }) {
  return http.post(LINEAR_API, async ({ request }) => {
    const body = await request.json() as { query: string };
    if (body.query.includes('projects')) {
      return HttpResponse.json(projectsResponse);
    }
    if (body.query.includes('cycles')) {
      return HttpResponse.json(cyclesResponse);
    }
    if (body.query.includes('viewer')) {
      return HttpResponse.json({ data: { viewer: { id: 'user-001' } } });
    }
    return HttpResponse.json(issuesFixture);
  });
}

const server = setupServer(makeHandler());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): LinearConnector {
  const connector = new LinearConnector();
  connector.setTokens({ accessToken: 'test-access-token' });
  return connector;
}

describe('LinearConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set', async () => {
      const connector = makeConnector();
      const result = await connector.connect({});
      expect(result.isOk()).toBe(true);
    });

    it('fails when tokens are not set', async () => {
      const connector = new LinearConnector();
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — projects', () => {
    it('yields project entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'project') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(2);
      expect(entities[0]!.id).toBe('linear:project:project-001');
      expect(entities[0]!.label).toBe('Mobile App Relaunch');
      expect(entities[0]!.attributes['state']).toBe('started');
    });

    it('includes belongs_to team relationships', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'project') entities.push(entity);
      }

      const rels = entities[0]!.relationships.filter((r) => r.type === 'belongs_to');
      expect(rels.length).toBe(2);
    });

    it('handles null description gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'project') entities.push(entity);
      }

      expect(entities[1]!.attributes['description']).toBeNull();
    });
  });

  describe('sync() — cycles', () => {
    it('yields cycle entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'cycle') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(1);
      expect(entities[0]!.id).toBe('linear:cycle:cycle-001');
      expect(entities[0]!.label).toBe('Sprint 12');
      expect(entities[0]!.attributes['number']).toBe(12);
      expect(entities[0]!.attributes['team']).toBe('ENG');
    });
  });

  describe('sync() — issues', () => {
    it('yields issue entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(3);
      expect(entities[0]!.id).toBe('linear:issue:issue-001');
      expect(entities[0]!.label).toBe('ENG-1: Fix login page crash on mobile');
      expect(entities[0]!.type).toBe('issue');
    });

    it('captures issue metadata in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const first = entities[0]!;
      expect(first.attributes['status']).toBe('In Progress');
      expect(first.attributes['priority']).toBe('Urgent');
      expect(first.attributes['assignee']).toBe('Alice Smith');
      expect(first.attributes['labels']).toBe('bug, mobile');
      expect(first.attributes['team']).toBe('ENG');
    });

    it('includes belongs_to team relationship', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'belongs_to');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('linear:team:team-001');
    });

    it('includes in_cycle relationship when cycleId is set', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const cycleRel = entities[0]!.relationships.find((r) => r.type === 'in_cycle');
      expect(cycleRel).toBeDefined();
      expect(cycleRel!.targetId).toBe('linear:cycle:cycle-001');
    });

    it('omits in_cycle relationship when cycleId is null', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const issue2 = entities.find((e) => e.id === 'linear:issue:issue-002');
      const cycleRel = issue2!.relationships.find((r) => r.type === 'in_cycle');
      expect(cycleRel).toBeUndefined();
    });

    it('handles null assignee gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const issue2 = entities.find((e) => e.id === 'linear:issue:issue-002');
      expect(issue2!.attributes['assignee']).toBeNull();
    });

    it('handles empty labels gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({});

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const issue2 = entities.find((e) => e.id === 'linear:issue:issue-002');
      expect(issue2!.attributes['labels']).toBeNull();
    });

    it('passes updatedAt filter when lastSyncedAt is provided', async () => {
      let capturedBody: { query: string } | null = null;
      server.use(
        http.post(LINEAR_API, async ({ request }) => {
          const body = await request.json() as { query: string };
          if (body.query.includes('issues')) {
            capturedBody = body;
            return HttpResponse.json(issuesFixture);
          }
          if (body.query.includes('projects')) return HttpResponse.json(projectsResponse);
          if (body.query.includes('cycles')) return HttpResponse.json(cyclesResponse);
          return HttpResponse.json({ data: {} });
        }),
      );

      const connector = makeConnector();
      await connector.connect({});

      for await (const _ of connector.sync({ lastSyncedAt: new Date('2026-05-15T00:00:00.000Z') })) {
        // consume
      }

      expect(capturedBody?.query).toContain('2026-05-15');
      expect(capturedBody?.query).toContain('updatedAt');
    });
  });

  describe('sync() — error handling', () => {
    it('throws ConnectorError when API returns 500', async () => {
      server.use(
        http.post(LINEAR_API, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({});

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws ConnectorError when API returns 401', async () => {
      server.use(
        http.post(LINEAR_API, () => HttpResponse.json({}, { status: 401 })),
      );

      const connector = makeConnector();
      await connector.connect({});

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    });

    it('throws when connector is not connected', async () => {
      const connector = new LinearConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when viewer query succeeds', async () => {
      server.use(
        http.post(LINEAR_API, () =>
          HttpResponse.json({ data: { viewer: { id: 'user-001' } } }),
        ),
      );

      const connector = makeConnector();
      await connector.connect({});
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const connector = new LinearConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('Not connected');
    });

    it('returns healthy:false when API returns error', async () => {
      server.use(
        http.post(LINEAR_API, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({});
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('500');
    });
  });

  describe('getSchema()', () => {
    it('returns issue, project, and cycle entity types', async () => {
      const connector = new LinearConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((t) => t.name);
      expect(names).toContain('issue');
      expect(names).toContain('project');
      expect(names).toContain('cycle');
    });

    it('lists key fields for each entity type', async () => {
      const connector = new LinearConnector();
      const schema = await connector.getSchema();
      const issueAttrs = schema.entityTypes.find((t) => t.name === 'issue')!.attributes.map((a) => a.name);
      const cycleAttrs = schema.entityTypes.find((t) => t.name === 'cycle')!.attributes.map((a) => a.name);
      expect(issueAttrs).toContain('status');
      expect(cycleAttrs).toContain('number');
    });
  });
});
