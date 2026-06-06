import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { NetSuiteConnector } from '../netsuite-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import customersFixture from '../../tests/fixtures/customers.json' assert { type: 'json' };
import vendorsFixture from '../../tests/fixtures/vendors.json' assert { type: 'json' };
import itemsFixture from '../../tests/fixtures/items.json' assert { type: 'json' };
import transactionsFixture from '../../tests/fixtures/transactions.json' assert { type: 'json' };

const ACCOUNT_ID = 'test-account-123';
const NS_API = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

const emptyList = { items: [], count: 0, hasMore: false, offset: 0, totalResults: 0 };

const server = setupServer(
  http.get(`${NS_API}/customer`, () => HttpResponse.json(customersFixture)),
  http.get(`${NS_API}/vendor`, () => HttpResponse.json(vendorsFixture)),
  http.get(`${NS_API}/inventoryItem`, () => HttpResponse.json(itemsFixture)),
  http.get(`${NS_API}/transaction`, () => HttpResponse.json(transactionsFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): NetSuiteConnector {
  const connector = new NetSuiteConnector();
  connector.setTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return connector;
}

describe('NetSuiteConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and accountId is valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ accountId: ACCOUNT_ID });
      expect(result.isOk()).toBe(true);
    });

    it('fails when accountId is missing', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ accountId: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('fails when tokens are not set', async () => {
      const connector = new NetSuiteConnector();
      const result = await connector.connect({ accountId: ACCOUNT_ID });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — customers', () => {
    it('yields customer entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'customer') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(2);
      expect(entities[0]!.id).toBe('netsuite:customer:cust-001');
      expect(entities[0]!.label).toBe('Acme Corporation');
      expect(entities[0]!.type).toBe('customer');
    });

    it('excludes PII email/phone from attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'customer') entities.push(entity);
      }

      expect(entities[0]!.attributes['email']).toBeUndefined();
      expect(entities[0]!.attributes['phone']).toBeUndefined();
    });

    it('captures subsidiary and status in attributes', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'customer') entities.push(entity);
      }

      expect(entities[0]!.attributes['subsidiary']).toBe('Global HQ');
      expect(entities[0]!.attributes['status']).toBe('Customer');
    });
  });

  describe('sync() — vendors', () => {
    it('yields vendor entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'vendor') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(1);
      expect(entities[0]!.id).toBe('netsuite:vendor:vendor-001');
      expect(entities[0]!.label).toBe('Supplier A Ltd');
      expect(entities[0]!.attributes['subsidiary']).toBe('Global HQ');
    });
  });

  describe('sync() — items', () => {
    it('yields item entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'item') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(2);
      expect(entities[0]!.id).toBe('netsuite:item:item-001');
      expect(entities[0]!.label).toBe('Widget Model A');
      expect(entities[0]!.attributes['itemType']).toBe('inventoryItem');
      expect(entities[0]!.attributes['basePrice']).toBe(99.99);
    });

    it('handles null displayName by falling back to itemId', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'item') entities.push(entity);
      }

      expect(entities[1]!.label).toBe('SVC-CONSULT');
    });

    it('handles null basePrice and description gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'item') entities.push(entity);
      }

      expect(entities[1]!.attributes['basePrice']).toBeNull();
      expect(entities[1]!.attributes['description']).toBeNull();
    });
  });

  describe('sync() — transactions', () => {
    it('yields transaction entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'transaction') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(1);
      expect(entities[0]!.id).toBe('netsuite:transaction:txn-001');
      expect(entities[0]!.label).toBe('Invoice INV-10001');
      expect(entities[0]!.attributes['amount']).toBe(4999);
      expect(entities[0]!.attributes['currency']).toBe('USD');
    });

    it('includes involves relationship to customer entity', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'transaction') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'involves');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('netsuite:customer:cust-001');
    });

    it('passes lastModifiedDate filter when lastSyncedAt is provided', async () => {
      const capturedUrls: string[] = [];
      server.use(
        http.get(`${NS_API}/customer`, ({ request }) => {
          capturedUrls.push(request.url);
          return HttpResponse.json(customersFixture);
        }),
        http.get(`${NS_API}/vendor`, () => HttpResponse.json(emptyList)),
        http.get(`${NS_API}/inventoryItem`, () => HttpResponse.json(emptyList)),
        http.get(`${NS_API}/transaction`, () => HttpResponse.json(emptyList)),
      );

      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      for await (const _ of connector.sync({ lastSyncedAt: new Date('2026-05-15T00:00:00.000Z') })) {
        // consume
      }

      expect(capturedUrls[0]).toContain('lastModifiedDate');
      expect(capturedUrls[0]).toContain('2026-05-15');
    });
  });

  describe('sync() — error handling', () => {
    it('throws ConnectorError when customer API returns 500', async () => {
      server.use(
        http.get(`${NS_API}/customer`, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws ConnectorError when vendor API returns 403', async () => {
      server.use(
        http.get(`${NS_API}/customer`, () => HttpResponse.json(emptyList)),
        http.get(`${NS_API}/vendor`, () => HttpResponse.json({}, { status: 403 })),
      );

      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws when connector is not connected', async () => {
      const connector = new NetSuiteConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when customer API responds 200', async () => {
      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const connector = new NetSuiteConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('Not connected');
    });

    it('returns healthy:false when API returns error', async () => {
      server.use(
        http.get(`${NS_API}/customer`, () => HttpResponse.json({}, { status: 503 })),
      );

      const connector = makeConnector();
      await connector.connect({ accountId: ACCOUNT_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('503');
    });
  });

  describe('getSchema()', () => {
    it('returns customer, vendor, item, transaction entity types', async () => {
      const connector = new NetSuiteConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((t) => t.name);
      expect(names).toContain('customer');
      expect(names).toContain('vendor');
      expect(names).toContain('item');
      expect(names).toContain('transaction');
    });

    it('lists key fields for each entity type', async () => {
      const connector = new NetSuiteConnector();
      const schema = await connector.getSchema();
      const customerAttrs = schema.entityTypes.find((t) => t.name === 'customer')!.attributes.map((a) => a.name);
      const txnAttrs = schema.entityTypes.find((t) => t.name === 'transaction')!.attributes.map((a) => a.name);
      expect(customerAttrs).toContain('subsidiary');
      expect(txnAttrs).toContain('amount');
    });
  });
});
