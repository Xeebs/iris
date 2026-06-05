import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { HubSpotConnector } from '../hubspot-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import contactsFixture from '../../tests/fixtures/contacts.json' assert { type: 'json' };
import companiesFixture from '../../tests/fixtures/companies.json' assert { type: 'json' };
import dealsFixture from '../../tests/fixtures/deals.json' assert { type: 'json' };

const VALID_TOKENS = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const server = setupServer(
  http.get('https://api.hubapi.com/crm/v3/objects/contacts', () =>
    HttpResponse.json(contactsFixture),
  ),
  http.get('https://api.hubapi.com/crm/v3/objects/companies', () =>
    HttpResponse.json(companiesFixture),
  ),
  http.get('https://api.hubapi.com/crm/v3/objects/deals', () =>
    HttpResponse.json(dealsFixture),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): HubSpotConnector {
  const connector = new HubSpotConnector();
  connector.setTokens(VALID_TOKENS);
  return connector;
}

describe('HubSpotConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ portalId: '12345' });
      expect(result.isOk()).toBe(true);
    });

    it('fails when no tokens are set', async () => {
      const connector = new HubSpotConnector();
      const result = await connector.connect({ portalId: '12345' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });

    it('fails when config is invalid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ portalId: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });
  });

  describe('sync()', () => {
    it('yields contacts, companies, and deals', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({})) {
        entities.push(entity);
      }

      expect(entities.length).toBe(4); // 2 contacts + 1 company + 1 deal
      const types = entities.map((e) => e.type);
      expect(types).toContain('contact');
      expect(types).toContain('company');
      expect(types).toContain('deal');
    });

    it('all yielded entities pass shape validation', async () => {
      const connector = makeConnector();
      for await (const entity of connector.sync({})) {
        expect(() => assertEntityShape(entity)).not.toThrow();
      }
    });

    it('contact entity has correct id format', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      expect(entities[0]?.id).toBe('hubspot:contact:1001');
    });

    it('contact entity label is built from firstname+lastname', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      expect(entities[0]?.label).toBe('Alice Smith');
    });

    it('contact entity has belongs_to relationship when associatedcompanyid set', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      const alice = entities.find((e) => e.id === 'hubspot:contact:1001');
      expect(alice?.relationships).toHaveLength(1);
      expect(alice?.relationships[0]?.targetId).toBe('hubspot:company:2001');
    });

    it('filters to specific entity types when specified', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['company'] })) {
        entities.push(entity);
      }
      expect(entities.every((e) => e.type === 'company')).toBe(true);
      expect(entities).toHaveLength(1);
    });

    it('handles 401 by throwing retryable ConnectorError', async () => {
      server.use(
        http.get('https://api.hubapi.com/crm/v3/objects/contacts', () =>
          new HttpResponse(null, { status: 401 }),
        ),
      );
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({ entityTypes: ['contact'] })) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'AUTH_EXPIRED', retryable: true });
    });

    it('handles 429 by throwing retryable ConnectorError', async () => {
      server.use(
        http.get('https://api.hubapi.com/crm/v3/objects/contacts', () =>
          new HttpResponse(null, { status: 429 }),
        ),
      );
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({ entityTypes: ['contact'] })) {
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
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns healthy=false when API is down', async () => {
      server.use(
        http.get('https://api.hubapi.com/crm/v3/objects/contacts', () =>
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
    it('returns schema with contact, company, and deal entity types', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const typeNames = schema.entityTypes.map((t) => t.name);
      expect(typeNames).toContain('contact');
      expect(typeNames).toContain('company');
      expect(typeNames).toContain('deal');
    });
  });
});
