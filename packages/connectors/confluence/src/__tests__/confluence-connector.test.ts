import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ConfluenceConnector } from '../confluence-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import spacesFixture from '../../tests/fixtures/spaces.json' assert { type: 'json' };
import pagesFixture from '../../tests/fixtures/pages.json' assert { type: 'json' };

const CLOUD_ID = 'test-cloud-id';
const CONFLUENCE_API = `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/rest/api`;

const server = setupServer(
  http.get(`${CONFLUENCE_API}/space`, () => HttpResponse.json(spacesFixture)),
  http.get(`${CONFLUENCE_API}/content/search`, () => HttpResponse.json(pagesFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): ConfluenceConnector {
  const connector = new ConfluenceConnector();
  connector.setTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return connector;
}

describe('ConfluenceConnector', () => {
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
      const connector = new ConfluenceConnector();
      const result = await connector.connect({ cloudId: CLOUD_ID });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — spaces', () => {
    it('yields space entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'space') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBeGreaterThanOrEqual(2);
      expect(entities[0]!.id).toBe('confluence:space:space-001');
      expect(entities[0]!.label).toBe('Engineering (ENG)');
      expect(entities[0]!.type).toBe('space');
      expect(entities[0]!.attributes['key']).toBe('ENG');
    });

    it('includes description and spaceType in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'space') entities.push(entity);
      }

      expect(entities[0]!.attributes['spaceType']).toBe('global');
      expect(entities[0]!.attributes['description']).toBe('Engineering team knowledge base');
    });
  });

  describe('sync() — pages', () => {
    it('yields page entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBeGreaterThanOrEqual(3);
      expect(entities[0]!.id).toBe('confluence:page:page-001');
      expect(entities[0]!.label).toBe('API Design Guidelines');
      expect(entities[0]!.type).toBe('page');
    });

    it('captures page metadata in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') entities.push(entity);
      }

      const firstPage = entities[0]!;
      expect(firstPage.attributes['space']).toBe('ENG');
      expect(firstPage.attributes['author']).toBe('Alice Smith');
      expect(firstPage.attributes['labels']).toBe('api, guidelines');
      expect(firstPage.attributes['version']).toBe(5);
    });

    it('includes belongs_to space relationship', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'belongs_to');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('confluence:space:space-001');
    });

    it('includes child_of relationship for pages with ancestors', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') entities.push(entity);
      }

      const page2 = entities.find((e) => e.id === 'confluence:page:page-002');
      expect(page2).toBeDefined();
      const parentRel = page2!.relationships.find((r) => r.type === 'child_of');
      expect(parentRel).toBeDefined();
      expect(parentRel!.targetId).toBe('confluence:page:page-001');
    });

    it('handles null author gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') entities.push(entity);
      }

      const page3 = entities.find((e) => e.id === 'confluence:page:page-003');
      expect(page3!.attributes['author']).toBeNull();
    });

    it('handles empty labels gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'page') entities.push(entity);
      }

      const page3 = entities.find((e) => e.id === 'confluence:page:page-003');
      expect(page3!.attributes['labels']).toBeNull();
    });

    it('uses CQL lastModified cursor when lastSyncedAt is provided', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${CONFLUENCE_API}/content/search`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(pagesFixture);
        }),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      for await (const _ of connector.sync({ lastSyncedAt: new Date('2026-05-15T00:00:00.000Z') })) {
        // consume
      }

      expect(capturedUrl).toContain('lastModified');
      expect(capturedUrl).toContain('2026-05-15');
    });
  });

  describe('sync() — error handling', () => {
    it('throws ConnectorError when space API returns 500', async () => {
      server.use(
        http.get(`${CONFLUENCE_API}/space`, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws ConnectorError when page search returns 403', async () => {
      server.use(
        http.get(`${CONFLUENCE_API}/space`, () => HttpResponse.json({ results: [], size: 0, limit: 50 })),
        http.get(`${CONFLUENCE_API}/content/search`, () => HttpResponse.json({}, { status: 403 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws when connector is not connected', async () => {
      const connector = new ConfluenceConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when space API responds 200', async () => {
      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const connector = new ConfluenceConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('Not connected');
    });

    it('returns healthy:false when API returns error', async () => {
      server.use(
        http.get(`${CONFLUENCE_API}/space`, () => HttpResponse.json({}, { status: 503 })),
      );

      const connector = makeConnector();
      await connector.connect({ cloudId: CLOUD_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('503');
    });
  });

  describe('getSchema()', () => {
    it('returns space and page entity types', async () => {
      const connector = new ConfluenceConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((t) => t.name);
      expect(names).toContain('space');
      expect(names).toContain('page');
    });

    it('lists key fields for each entity type', async () => {
      const connector = new ConfluenceConnector();
      const schema = await connector.getSchema();
      const spaceAttrs = schema.entityTypes.find((t) => t.name === 'space')!.attributes.map((a) => a.name);
      const pageAttrs = schema.entityTypes.find((t) => t.name === 'page')!.attributes.map((a) => a.name);
      expect(spaceAttrs).toContain('key');
      expect(pageAttrs).toContain('author');
    });
  });
});
