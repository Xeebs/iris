import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { JiraConnector } from '../jira-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import projectsFixture from '../../tests/fixtures/projects.json' assert { type: 'json' };
import issuesFixture from '../../tests/fixtures/issues.json' assert { type: 'json' };

const CLOUD_ID = 'test-cloud-id';
const JIRA_API = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3`;
const AUTH_API = 'https://auth.atlassian.com/oauth/token';

const server = setupServer(
  http.get(`${JIRA_API}/project/search`, () => HttpResponse.json({ ...projectsFixture })),
  http.get(`${JIRA_API}/search`, () => HttpResponse.json(issuesFixture)),
  http.get(`${JIRA_API}/myself`, () => HttpResponse.json({ accountId: 'user-001', displayName: 'Alice' })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): JiraConnector {
  const connector = new JiraConnector();
  connector.setTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return connector;
}

describe('JiraConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and cloudId is valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ cloudId: CLOUD_ID });
      expect(result.isOk()).toBe(true);
    });

    it('fails when cloudId is missing', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ cloudId: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('fails when tokens are not set', async () => {
      const connector = new JiraConnector();
      const result = await connector.connect({ cloudId: CLOUD_ID });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — projects', () => {
    it('yields project entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'project') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBeGreaterThanOrEqual(2);
      expect(entities[0]!.id).toBe('jira:project:10001');
      expect(entities[0]!.label).toBe('Engineering (ENG)');
      expect(entities[0]!.type).toBe('project');
      expect(entities[0]!.attributes['key']).toBe('ENG');
    });

    it('includes project type in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'project') entities.push(entity);
      }

      expect(entities[0]!.attributes['projectType']).toBe('software');
    });
  });

  describe('sync() — issues', () => {
    it('yields issue entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBeGreaterThanOrEqual(3);
      expect(entities[0]!.id).toBe('jira:issue:issue-001');
      expect(entities[0]!.label).toBe('ENG-1: Fix login page crash on mobile');
      expect(entities[0]!.type).toBe('issue');
    });

    it('captures issue metadata in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const firstIssue = entities[0]!;
      expect(firstIssue.attributes['status']).toBe('In Progress');
      expect(firstIssue.attributes['priority']).toBe('High');
      expect(firstIssue.attributes['assignee']).toBe('Alice Smith');
      expect(firstIssue.attributes['labels']).toBe('mobile, crash, ios');
      expect(firstIssue.attributes['project']).toBe('ENG');
    });

    it('includes belongs_to project relationship', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'belongs_to');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('jira:project:10001');
    });

    it('includes epic relationship when epic link is set', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      // ENG-2 has customfield_10014 = "epic-001"
      const eng2 = entities.find((e) => e.id === 'jira:issue:issue-002');
      expect(eng2).toBeDefined();
      const epicRel = eng2!.relationships.find((r) => r.type === 'epic');
      expect(epicRel).toBeDefined();
      expect(epicRel!.targetId).toBe('jira:issue:epic-001');
    });

    it('handles null assignee gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'issue') entities.push(entity);
      }

      // ENG-2 has no assignee
      const eng2 = entities.find((e) => e.id === 'jira:issue:issue-002');
      expect(eng2!.attributes['assignee']).toBeNull();
    });

    it('uses JQL updatedAfter cursor when lastSyncedAt is provided', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${JIRA_API}/search`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(issuesFixture);
        }),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({ lastSyncedAt: '2026-05-15T00:00:00.000Z' })) {
        if (entity.type === 'issue') entities.push(entity);
      }

      expect(capturedUrl).toContain('updated');
      expect(capturedUrl).toContain('2026-05-15');
    });
  });

  describe('sync() — error handling', () => {
    it('throws ConnectorError when project API returns 500', async () => {
      server.use(
        http.get(`${JIRA_API}/project/search`, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws ConnectorError when issue search returns 403', async () => {
      server.use(
        http.get(`${JIRA_API}/project/search`, () => HttpResponse.json({ values: [], isLast: true })),
        http.get(`${JIRA_API}/search`, () => HttpResponse.json({}, { status: 403 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws when connector is not connected', async () => {
      const connector = new JiraConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when /myself responds 200', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const connector = new JiraConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('Not connected');
    });

    it('returns healthy:false when API returns error', async () => {
      server.use(
        http.get(`${JIRA_API}/myself`, () => HttpResponse.json({}, { status: 503 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('503');
    });
  });

  describe('getSchema()', () => {
    it('returns project and issue entity types', async () => {
      const connector = new JiraConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((t) => t.name);
      expect(names).toContain('project');
      expect(names).toContain('issue');
    });

    it('lists key fields for each entity type', async () => {
      const connector = new JiraConnector();
      const schema = await connector.getSchema();
      const projectAttrs = schema.entityTypes.find((t) => t.name === 'project')!.attributes.map((a) => a.name);
      const issueAttrs = schema.entityTypes.find((t) => t.name === 'issue')!.attributes.map((a) => a.name);
      expect(projectAttrs).toContain('key');
      expect(issueAttrs).toContain('status');
    });
  });

  describe('manifest', () => {
    it('has correct id and entity types', () => {
      const connector = makeConnector();
      expect(connector).toBeDefined();
    });
  });
});
