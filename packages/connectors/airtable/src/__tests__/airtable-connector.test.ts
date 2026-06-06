import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AirtableConnector } from '../airtable-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import basesFixture from '../../tests/fixtures/bases.json' assert { type: 'json' };
import tablesFixture from '../../tests/fixtures/tables.json' assert { type: 'json' };
import recordsFixture from '../../tests/fixtures/records.json' assert { type: 'json' };

const API = 'https://api.airtable.com/v0';

const server = setupServer(
  http.get(`${API}/meta/bases`, () => HttpResponse.json(basesFixture)),
  http.get(`${API}/meta/bases/:baseId/tables`, () => HttpResponse.json(tablesFixture)),
  http.get(`${API}/:baseId/:tableId`, () => HttpResponse.json(recordsFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): AirtableConnector {
  const connector = new AirtableConnector();
  connector.setAccessToken('test-token');
  return connector;
}

describe('AirtableConnector', () => {
  describe('connect()', () => {
    it('succeeds when access token is set', async () => {
      const connector = makeConnector();
      const result = await connector.connect({});
      expect(result.isOk()).toBe(true);
    });

    it('fails when no access token is set', async () => {
      const connector = new AirtableConnector();
      const result = await connector.connect({});
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync()', () => {
    it('yields base entities', async () => {
      const connector = makeConnector();
      const entities: ReturnType<typeof assertEntityShape>[] = [];

      for await (const entity of connector.sync({ entityTypes: ['base'] })) {
        assertEntityShape(entity);
        entities.push(entity);
      }

      expect(entities.length).toBe(2); // two bases in fixture
      expect(entities[0]!.type).toBe('base');
      expect(entities[0]!.id).toBe('airtable:base:appAbc123');
      expect(entities[0]!.label).toBe('Sales Pipeline');
    });

    it('yields record entities', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({ entityTypes: ['record'] })) {
        assertEntityShape(entity);
        entities.push(entity);
      }

      // 2 bases × 2 records each = 4 records
      expect(entities.length).toBe(4);
      expect(entities[0]!.type).toBe('record');
      expect(entities[0]!.label).toContain('Contacts: Alice Smith');
    });

    it('yields both bases and records when no entityTypes filter', async () => {
      const connector = makeConnector();
      const entities = [];

      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      // 2 bases + 4 records = 6
      expect(entities.length).toBe(6);
    });

    it('yields correct entity ID format for records', async () => {
      const connector = makeConnector();

      for await (const entity of connector.sync({ entityTypes: ['record'] })) {
        expect(entity.id).toMatch(/^airtable:record:.+:.+:.+$/);
        break;
      }
    });

    it('adds belongs_to relationship from record to base', async () => {
      const connector = makeConnector();

      for await (const entity of connector.sync({ entityTypes: ['record'] })) {
        expect(entity.relationships).toHaveLength(1);
        expect(entity.relationships[0]!.type).toBe('belongs_to');
        expect(entity.relationships[0]!.targetId).toMatch(/^airtable:base:/);
        break;
      }
    });

    it('handles 401 auth failure', async () => {
      server.use(
        http.get(`${API}/meta/bases`, () => HttpResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 })),
      );

      const connector = makeConnector();
      const gen = connector.sync({ entityTypes: ['base'] });

      await expect(gen.next()).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    });

    it('handles 429 rate limit', async () => {
      server.use(
        http.get(`${API}/meta/bases`, () => new HttpResponse(null, { status: 429 })),
      );

      const connector = makeConnector();
      const gen = connector.sync({ entityTypes: ['base'] });

      await expect(gen.next()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('respects the baseIds config filter', async () => {
      const connector = makeConnector();

      // Track which bases were fetched for tables
      const requestedBaseIds: string[] = [];
      server.use(
        http.get(`${API}/meta/bases/:baseId/tables`, ({ params }) => {
          requestedBaseIds.push(params['baseId'] as string);
          return HttpResponse.json(tablesFixture);
        }),
      );

      const entities = [];
      for await (const entity of connector.sync({
        entityTypes: ['record'],
        config: { baseIds: ['appAbc123'] },
      } as Parameters<typeof connector.sync>[0])) {
        entities.push(entity);
      }

      expect(requestedBaseIds).toEqual(['appAbc123']);
      expect(entities.length).toBe(2); // only records from the filtered base
    });
  });

  describe('getSchema()', () => {
    it('returns entity types for base and record', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();

      expect(schema.entityTypes.map((e) => e.name)).toContain('base');
      expect(schema.entityTypes.map((e) => e.name)).toContain('record');
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy when API responds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy when API returns 401', async () => {
      server.use(
        http.get(`${API}/meta/bases`, () => HttpResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })),
      );

      const connector = makeConnector();
      const status = await connector.healthCheck();

      expect(status.healthy).toBe(false);
      expect(status.error).toBeTruthy();
    });
  });
});
