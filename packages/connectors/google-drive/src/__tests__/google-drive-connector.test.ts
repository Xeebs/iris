import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { GoogleDriveConnector } from '../google-drive-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import filesFixture from '../../tests/fixtures/files.json' assert { type: 'json' };

const VALID_TOKENS = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const server = setupServer(
  http.get('https://www.googleapis.com/drive/v3/files', () =>
    HttpResponse.json(filesFixture),
  ),
  http.get('https://www.googleapis.com/drive/v3/about', () =>
    HttpResponse.json({ user: { displayName: 'Test User', emailAddress: 'test@example.com' } }),
  ),
  http.get('https://www.googleapis.com/drive/v3/files/:id', ({ params }) => {
    if (typeof params['id'] === 'string' && params['id'].startsWith('file-002')) {
      return HttpResponse.text('This is the content of the README file.');
    }
    return HttpResponse.json({ error: { code: 404, message: 'Not found' } }, { status: 404 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): GoogleDriveConnector {
  const connector = new GoogleDriveConnector();
  connector.setTokens(VALID_TOKENS);
  return connector;
}

describe('GoogleDriveConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({});
      expect(result.isOk()).toBe(true);
    });

    it('fails when no tokens are set', async () => {
      const connector = new GoogleDriveConnector();
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });

    it('fails when token is expired', async () => {
      const connector = new GoogleDriveConnector();
      connector.setTokens({
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() - 1000),
      });
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('sync()', () => {
    it('yields files and folders from the fixture', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities.length).toBe(3);
      const types = entities.map((e) => e.type);
      expect(types).toContain('file');
      expect(types).toContain('folder');
    });

    it('all yielded entities pass shape validation', async () => {
      const connector = makeConnector();
      for await (const entity of connector.sync({})) {
        expect(() => assertEntityShape(entity)).not.toThrow();
      }
    });

    it('folder entity has correct type and label', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }
      const folder = entities.find((e) => e.type === 'folder');
      expect(folder).toBeDefined();
      expect(folder?.label).toBe('Sales Documents');
      expect(folder?.id).toBe('google-drive:folder:folder-001');
    });

    it('file entity has correct attributes', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }
      const file = entities.find((e) => e.id === 'google-drive:file:file-001');
      expect(file).toBeDefined();
      expect(file?.attributes['mimeType']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(file?.attributes['description']).toBe('Quarterly sales analysis for Q4 2023');
    });

    it('handles partial sync failure without crashing', async () => {
      server.use(
        http.get('https://www.googleapis.com/drive/v3/files', () =>
          HttpResponse.json({ files: [filesFixture.files[0]] }),
        ),
      );
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }
      expect(entities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getSchema()', () => {
    it('returns schema with file and folder entity types', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const typeNames = schema.entityTypes.map((t) => t.name);
      expect(typeNames).toContain('file');
      expect(typeNames).toContain('folder');
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy when API responds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy when API fails', async () => {
      server.use(
        http.get('https://www.googleapis.com/drive/v3/about', () =>
          HttpResponse.json({ error: { code: 500 } }, { status: 500 }),
        ),
      );
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toBeDefined();
    });
  });
});
