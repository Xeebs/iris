import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { QuickBooksConnector } from '../quickbooks-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

import customersFixture from '../../tests/fixtures/customers.json' assert { type: 'json' };
import invoicesData from '../../tests/fixtures/invoices.json' assert { type: 'json' };

const REALM_ID = 'test-realm-123';
const QB_API = `https://quickbooks.api.intuit.com/v3/company/${REALM_ID}`;
const HEALTH_URL = `${QB_API}/query`;

const emptyResponse = (entityType: string) => ({
  QueryResponse: { [entityType]: [], startPosition: 1, maxResults: 100 },
});

// MSW handler matching QB query API
const server = setupServer(
  http.get(`${QB_API}/query`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') ?? '';

    if (query.includes('CompanyInfo')) {
      return HttpResponse.json({ QueryResponse: { CompanyInfo: [{ Id: '1' }], startPosition: 1, maxResults: 1 } });
    }
    if (query.includes('Customer')) {
      return HttpResponse.json(customersFixture);
    }
    if (query.includes('Vendor')) {
      return HttpResponse.json(invoicesData.vendors);
    }
    if (query.includes('Invoice')) {
      return HttpResponse.json(invoicesData.invoices);
    }
    if (query.includes('Purchase')) {
      return HttpResponse.json(invoicesData.expenses);
    }
    return HttpResponse.json({ QueryResponse: { startPosition: 1, maxResults: 0 } });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): QuickBooksConnector {
  const connector = new QuickBooksConnector();
  connector.setTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
  return connector;
}

describe('QuickBooksConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and realmId is valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ realmId: REALM_ID });
      expect(result.isOk()).toBe(true);
    });

    it('fails when realmId is missing', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ realmId: '' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });

    it('fails when tokens are not set', async () => {
      const connector = new QuickBooksConnector();
      const result = await connector.connect({ realmId: REALM_ID });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });
  });

  describe('sync() — customers', () => {
    it('yields customer entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'customer') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(2);
      expect(entities[0]!.id).toBe('quickbooks:customer:1');
      expect(entities[0]!.label).toBe('Acme Corp');
      expect(entities[0]!.attributes['companyName']).toBe('Acme Corporation');
      expect(entities[0]!.attributes['balance']).toBe(2500);
    });
  });

  describe('sync() — vendors', () => {
    it('yields vendor entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'vendor') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(1);
      expect(entities[0]!.id).toBe('quickbooks:vendor:10');
      expect(entities[0]!.label).toBe('Office Supplies Ltd');
    });
  });

  describe('sync() — invoices', () => {
    it('yields invoice entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'invoice') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(2);
      expect(entities[0]!.id).toBe('quickbooks:invoice:100');
      expect(entities[0]!.label).toBe('Invoice INV-001');
      expect(entities[0]!.attributes['totalAmount']).toBe(4999);
      expect(entities[0]!.attributes['dueDate']).toBe('2026-06-15');
      expect(entities[0]!.attributes['emailStatus']).toBe('EmailSent');
    });

    it('includes billed_to customer relationship', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'invoice') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'billed_to');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('quickbooks:customer:1');
    });

    it('handles null DocNumber and DueDate gracefully', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'invoice') entities.push(entity);
      }

      expect(entities[1]!.label).toBe('Invoice 101');
      expect(entities[1]!.attributes['dueDate']).toBeNull();
      expect(entities[1]!.attributes['currency']).toBeNull();
    });
  });

  describe('sync() — expenses', () => {
    it('yields expense entities with correct shape', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'expense') {
          assertEntityShape(entity);
          entities.push(entity);
        }
      }

      expect(entities.length).toBe(1);
      expect(entities[0]!.id).toBe('quickbooks:expense:200');
      expect(entities[0]!.attributes['paymentType']).toBe('Cash');
      expect(entities[0]!.attributes['totalAmount']).toBe(150);
    });

    it('includes paid_to vendor relationship', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      const entities = [];
      for await (const entity of connector.sync({})) {
        if (entity.type === 'expense') entities.push(entity);
      }

      const rel = entities[0]!.relationships.find((r) => r.type === 'paid_to');
      expect(rel).toBeDefined();
      expect(rel!.targetId).toBe('quickbooks:vendor:10');
    });

    it('uses LastUpdatedTime filter when lastSyncedAt is provided', async () => {
      const capturedUrls: string[] = [];
      server.use(
        http.get(`${QB_API}/query`, ({ request }) => {
          capturedUrls.push(request.url);
          const url = new URL(request.url);
          const query = url.searchParams.get('query') ?? '';
          if (query.includes('CompanyInfo')) {
            return HttpResponse.json({ QueryResponse: { CompanyInfo: [{ Id: '1' }], startPosition: 1, maxResults: 1 } });
          }
          if (query.includes('Customer')) return HttpResponse.json(customersFixture);
          if (query.includes('Vendor')) return HttpResponse.json(invoicesData.vendors);
          if (query.includes('Invoice')) return HttpResponse.json(invoicesData.invoices);
          if (query.includes('Purchase')) return HttpResponse.json(invoicesData.expenses);
          return HttpResponse.json({ QueryResponse: { startPosition: 1, maxResults: 0 } });
        }),
      );

      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      for await (const _ of connector.sync({ lastSyncedAt: new Date('2026-05-15T00:00:00.000Z') })) {
        // consume
      }

      const customerUrl = capturedUrls.find((u) => u.includes('Customer'));
      expect(customerUrl).toContain('LastUpdatedTime');
      expect(customerUrl).toContain('2026-05-15');
    });
  });

  describe('sync() — error handling', () => {
    it('throws ConnectorError when API returns 500', async () => {
      server.use(
        http.get(`${QB_API}/query`, () => HttpResponse.json({}, { status: 500 })),
      );

      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });

      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });

    it('throws when connector is not connected', async () => {
      const connector = new QuickBooksConnector();
      await expect(async () => {
        for await (const _ of connector.sync({})) { /* consume */ }
      }).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when company info query succeeds', async () => {
      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when not connected', async () => {
      const connector = new QuickBooksConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('Not connected');
    });

    it('returns healthy:false when API returns error', async () => {
      server.use(
        http.get(HEALTH_URL, () => HttpResponse.json({}, { status: 503 })),
      );

      const connector = makeConnector();
      await connector.connect({ realmId: REALM_ID });
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.error).toContain('503');
    });
  });

  describe('getSchema()', () => {
    it('returns customer, vendor, invoice, expense entity types', async () => {
      const connector = new QuickBooksConnector();
      const schema = await connector.getSchema();
      const names = schema.entityTypes.map((t) => t.name);
      expect(names).toContain('customer');
      expect(names).toContain('vendor');
      expect(names).toContain('invoice');
      expect(names).toContain('expense');
    });

    it('lists key fields for each entity type', async () => {
      const connector = new QuickBooksConnector();
      const schema = await connector.getSchema();
      const invoiceAttrs = schema.entityTypes.find((t) => t.name === 'invoice')!.attributes.map((a) => a.name);
      expect(invoiceAttrs).toContain('totalAmount');
      expect(invoiceAttrs).toContain('txnDate');
    });
  });
});
