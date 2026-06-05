import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NotionConnector } from '../notion-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import pagesFixture from '../../tests/fixtures/pages.json' assert { type: 'json' };
import databasesFixture from '../../tests/fixtures/databases.json' assert { type: 'json' };

const VALID_TOKENS = {
  accessToken: 'test-access-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const server = setupServer(
  http.post('https://api.notion.com/v1/search', () =>
    HttpResponse.json({ ...pagesFixture, results: [...pagesFixture.results, ...databasesFixture.results] }),
  ),
  http.get('https://api.notion.com/v1/users/me', () =>
    HttpResponse.json({ id: 'user-1', name: 'Test User' }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): NotionConnector {
  const connector = new NotionConnector();
  connector.setTokens(VALID_TOKENS);
  return connector;
}

describe('NotionConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set', async () => {
      const connector = makeConnector();
      const result = await connector.connect({});
      expect(result.isOk()).toBe(true);
    });

    it('fails when no tokens are set', async () => {
      const connector = new NotionConnector();
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync()', () => {
    it('yields pages and database rows', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }
      expect(entities.length).toBe(2);
    });

    it('all yielded entities pass shape validation', async () => {
      const connector = makeConnector();
      for await (const entity of connector.sync({})) {
        expect(() => assertEntityShape(entity)).not.toThrow();
      }
    });

    it('page entity has correct id format', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['page'] })) {
        entities.push(entity);
      }
      expect(entities[0]?.id).toBe('notion:page:page-001');
      expect(entities[0]?.label).toBe('Project Roadmap');
    });

    it('page entity extracts select and multi_select attributes', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['page'] })) {
        entities.push(entity);
      }
      expect(entities[0]?.attributes['Status']).toBe('In Progress');
      expect(entities[0]?.attributes['Tags']).toEqual(['product', 'planning']);
    });

    it('database row has belongs_to relationship', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['database_row'] })) {
        entities.push(entity);
      }
      expect(entities[0]?.id).toBe('notion:database_row:row-001');
      expect(entities[0]?.relationships[0]?.targetId).toBe('notion:database:db-001');
    });

    it('filters to specific entity types', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['page'] })) {
        entities.push(entity);
      }
      expect(entities.every((e) => e.type === 'page')).toBe(true);
    });

    it('handles 401 by throwing retryable ConnectorError', async () => {
      server.use(
        http.post('https://api.notion.com/v1/search', () =>
          new HttpResponse(null, { status: 401 }),
        ),
      );
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'AUTH_EXPIRED', retryable: true });
    });

    it('handles 429 by throwing retryable ConnectorError', async () => {
      server.use(
        http.post('https://api.notion.com/v1/search', () =>
          new HttpResponse(null, { status: 429 }),
        ),
      );
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy=true when API responds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy=false when API is down', async () => {
      server.use(
        http.get('https://api.notion.com/v1/users/me', () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
    });
  });

  describe('getSchema()', () => {
    it('returns schema with page and database_row entity types', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const typeNames = schema.entityTypes.map((t) => t.name);
      expect(typeNames).toContain('page');
      expect(typeNames).toContain('database_row');
    });
  });
});
