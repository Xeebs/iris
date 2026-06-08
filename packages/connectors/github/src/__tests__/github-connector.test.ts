import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { GitHubConnector } from '../github-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';
import {
  transformRepository,
  transformIssue,
  transformPullRequest,
  transformDiscussion,
} from '../transformers.js';

import repositoriesFixture from '../../tests/fixtures/repositories.json' assert { type: 'json' };
import issuesFixture from '../../tests/fixtures/issues.json' assert { type: 'json' };
import pullRequestsFixture from '../../tests/fixtures/pull-requests.json' assert { type: 'json' };
import discussionsFixture from '../../tests/fixtures/discussions.json' assert { type: 'json' };

const VALID_TOKENS = {
  accessToken: 'ghp_test-access-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const OWNER = 'test-org';

const server = setupServer(
  http.get('https://api.github.com/users/:owner/repos', () =>
    HttpResponse.json(repositoriesFixture),
  ),
  http.get('https://api.github.com/repos/:owner/:repo/issues', () =>
    HttpResponse.json(issuesFixture),
  ),
  http.get('https://api.github.com/repos/:owner/:repo/pulls', () =>
    HttpResponse.json(pullRequestsFixture),
  ),
  http.get('https://api.github.com/repos/:owner/:repo/discussions', () =>
    HttpResponse.json(discussionsFixture),
  ),
  http.get('https://api.github.com/rate_limit', () =>
    HttpResponse.json({
      resources: { core: { limit: 5000, remaining: 4999, reset: 1800000000 } },
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): GitHubConnector {
  const connector = new GitHubConnector();
  connector.setTokens(VALID_TOKENS);
  return connector;
}

async function makeConnectedConnector(): Promise<GitHubConnector> {
  const connector = makeConnector();
  const result = await connector.connect({ owner: OWNER });
  if (result.isErr()) throw new Error(`connect() failed: ${result.error.message}`);
  return connector;
}

async function collectSync(connector: GitHubConnector, options: Parameters<GitHubConnector['sync']>[0] = {}) {
  const entities = [];
  for await (const entity of connector.sync(options)) {
    entities.push(entity);
  }
  return entities;
}

describe('GitHubConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and owner is valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ owner: OWNER });
      expect(result.isOk()).toBe(true);
    });

    it('fails when no tokens are set', async () => {
      const connector = new GitHubConnector();
      const result = await connector.connect({ owner: OWNER });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });

    it('fails when owner is empty string', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ owner: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('returns NOT_CONNECTED error when sync is called before connect', async () => {
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('sync()', () => {
    it('yields repositories, issues, pull requests, and discussions', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector);

      const types = new Set(entities.map((e) => e.type));
      expect(types.has('repository')).toBe(true);
      expect(types.has('issue')).toBe(true);
      expect(types.has('pull_request')).toBe(true);
      expect(types.has('discussion')).toBe(true);
    });

    it('all yielded entities pass shape validation', async () => {
      const connector = await makeConnectedConnector();
      for await (const entity of connector.sync({})) {
        expect(() => assertEntityShape(entity)).not.toThrow();
      }
    });

    it('repository entity has correct id format', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['repository'] });
      expect(entities[0]?.id).toBe('github:repository:test-org/iris-core');
    });

    it('repository entity label is full_name', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['repository'] });
      expect(entities[0]?.label).toBe('test-org/iris-core');
    });

    it('repository entity includes language and stars attributes', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['repository'] });
      const repo = entities.find((e) => e.id === 'github:repository:test-org/iris-core');
      expect(repo?.attributes.language).toBe('TypeScript');
      expect(repo?.attributes.stars).toBe(128);
    });

    it('issue entity has correct id format', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['issue'] });
      expect(entities[0]?.id).toBe('github:issue:test-org/iris-core#42');
    });

    it('issue entity label includes number and title', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['issue'] });
      expect(entities[0]?.label).toBe('#42: Fix semantic cache miss on empty query');
    });

    it('issue entity has belongs_to relationship to repository', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['issue'] });
      const issue = entities.find((e) => e.id === 'github:issue:test-org/iris-core#42');
      const belongsTo = issue?.relationships.find((r) => r.type === 'belongs_to');
      expect(belongsTo?.targetId).toBe('github:repository:test-org/iris-core');
    });

    it('issue entity has assigned_to relationship for assignees', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['issue'] });
      const issue = entities.find((e) => e.id === 'github:issue:test-org/iris-core#42');
      const assigned = issue?.relationships.find((r) => r.type === 'assigned_to');
      expect(assigned?.targetId).toBe('github:user:bob');
    });

    it('pull_request entity has correct id format', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['pull_request'] });
      expect(entities[0]?.id).toBe('github:pull_request:test-org/iris-core#55');
    });

    it('merged pull request reports state as merged', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['pull_request'] });
      const mergedPr = entities.find((e) => e.id === 'github:pull_request:test-org/iris-core#55');
      expect(mergedPr?.attributes.state).toBe('merged');
      expect(mergedPr?.attributes.merged).toBe(true);
    });

    it('draft pull request reports draft=true', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['pull_request'] });
      const draftPr = entities.find((e) => e.id === 'github:pull_request:test-org/iris-core#60');
      expect(draftPr?.attributes.draft).toBe(true);
    });

    it('pull_request entity has belongs_to relationship to repository', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['pull_request'] });
      const pr = entities[0];
      const belongsTo = pr?.relationships.find((r) => r.type === 'belongs_to');
      expect(belongsTo?.targetId).toMatch(/^github:repository:/);
    });

    it('discussion entity has correct id format', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['discussion'] });
      expect(entities[0]?.id).toBe('github:discussion:test-org/iris-core#12');
    });

    it('answered discussion reports answered=true', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['discussion'] });
      const answered = entities.find((e) => e.id === 'github:discussion:test-org/iris-core#12');
      expect(answered?.attributes.answered).toBe(true);
    });

    it('unanswered discussion reports answered=false', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['discussion'] });
      const unanswered = entities.find((e) => e.id === 'github:discussion:test-org/iris-core#15');
      expect(unanswered?.attributes.answered).toBe(false);
    });

    it('filters to specific entity types when specified', async () => {
      const connector = await makeConnectedConnector();
      const entities = await collectSync(connector, { entityTypes: ['repository'] });
      expect(entities.every((e) => e.type === 'repository')).toBe(true);
      expect(entities.length).toBe(2);
    });

    it('handles 401 by throwing retryable ConnectorError', async () => {
      server.use(
        http.get('https://api.github.com/users/:owner/repos', () =>
          new HttpResponse(null, { status: 401 }),
        ),
      );
      const connector = await makeConnectedConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'AUTH_EXPIRED', retryable: true });
    });

    it('handles 403 with rate limit header as RATE_LIMITED', async () => {
      server.use(
        http.get('https://api.github.com/users/:owner/repos', () =>
          new HttpResponse(null, {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          }),
        ),
      );
      const connector = await makeConnectedConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    });

    it('handles 500 by throwing non-retryable ConnectorError', async () => {
      server.use(
        http.get('https://api.github.com/users/:owner/repos', () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );
      const connector = await makeConnectedConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy=true when rate_limit endpoint responds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns healthy=false when API is down', async () => {
      server.use(
        http.get('https://api.github.com/rate_limit', () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('getSchema()', () => {
    it('returns schema with all four entity types', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const typeNames = schema.entityTypes.map((t) => t.name);
      expect(typeNames).toContain('repository');
      expect(typeNames).toContain('issue');
      expect(typeNames).toContain('pull_request');
      expect(typeNames).toContain('discussion');
    });

    it('schema version includes connector id', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      expect(schema.version).toMatch(/^github@/);
    });
  });

  describe('transformers', () => {
    it('transformRepository includes topics as comma-separated string', () => {
      const repo = repositoriesFixture[0];
      const entity = transformRepository(repo);
      expect(entity.attributes.topics).toBe('typescript, mcp, ai');
    });

    it('transformRepository with no topics returns null for topics', () => {
      const repo = repositoriesFixture[1];
      const entity = transformRepository(repo);
      expect(entity.attributes.topics).toBeNull();
    });

    it('transformIssue with no assignees has no assigned_to relationships', () => {
      const issue = issuesFixture[1];
      const entity = transformIssue(issue, OWNER, 'iris-core');
      const assigned = entity.relationships.filter((r) => r.type === 'assigned_to');
      expect(assigned).toHaveLength(0);
    });

    it('transformIssue with no labels returns null for labels attribute', () => {
      const issue = { ...issuesFixture[1], labels: [] };
      const entity = transformIssue(issue, OWNER, 'iris-core');
      expect(entity.attributes.labels).toBeNull();
    });

    it('transformPullRequest with reviewers creates review_requested_from relationships', () => {
      const pr = pullRequestsFixture[0];
      const entity = transformPullRequest(pr, OWNER, 'iris-core');
      const reviewRelationships = entity.relationships.filter((r) => r.type === 'review_requested_from');
      expect(reviewRelationships).toHaveLength(2);
      expect(reviewRelationships.map((r) => r.targetId)).toContain('github:user:alice');
    });

    it('transformDiscussion sets answered=true when answer_html_url is present', () => {
      const discussion = discussionsFixture[0];
      const entity = transformDiscussion(discussion, OWNER, 'iris-core');
      expect(entity.attributes.answered).toBe(true);
    });
  });
});
