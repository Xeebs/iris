import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SalesforceConnector } from '../salesforce-connector.js';
import { assertEntityShape } from '@iris/connector-sdk';

const INSTANCE_URL = 'https://test.salesforce.com';
const API_BASE = `${INSTANCE_URL}/services/data/v57.0`;

const VALID_TOKENS = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  instanceUrl: INSTANCE_URL,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const contactsFixture = {
  totalSize: 2,
  done: true,
  records: [
    {
      Id: 'c001',
      FirstName: 'Alice',
      LastName: 'Smith',
      Email: 'alice@example.com',
      Phone: '+15551234567',
      Title: 'VP Sales',
      AccountId: 'a001',
      OwnerId: 'u001',
      LeadSource: 'Web',
      LastModifiedDate: '2024-01-15T12:00:00.000Z',
    },
    {
      Id: 'c002',
      FirstName: null,
      LastName: 'Jones',
      Email: null,
      Phone: null,
      Title: null,
      AccountId: null,
      OwnerId: 'u002',
      LeadSource: null,
      LastModifiedDate: '2024-01-16T12:00:00.000Z',
    },
  ],
};

const accountsFixture = {
  totalSize: 1,
  done: true,
  records: [
    {
      Id: 'a001',
      Name: 'Acme Corp',
      Industry: 'Technology',
      Website: 'https://acme.example.com',
      Phone: '+15559876543',
      BillingCity: 'San Francisco',
      BillingCountry: 'US',
      NumberOfEmployees: 500,
      AnnualRevenue: 10_000_000,
      OwnerId: 'u001',
      LastModifiedDate: '2024-01-10T09:00:00.000Z',
    },
  ],
};

const opportunitiesFixture = {
  totalSize: 1,
  done: true,
  records: [
    {
      Id: 'opp001',
      Name: 'Acme Enterprise Deal',
      AccountId: 'a001',
      StageName: 'Proposal/Price Quote',
      Amount: 75_000,
      CloseDate: '2024-03-31',
      Probability: 60,
      OwnerId: 'u001',
      LeadSource: 'Partner',
      LastModifiedDate: '2024-01-20T15:30:00.000Z',
    },
  ],
};

const server = setupServer(
  http.get(`${API_BASE}/query`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    if (q.includes('FROM Contact')) return HttpResponse.json(contactsFixture);
    if (q.includes('FROM Account')) return HttpResponse.json(accountsFixture);
    if (q.includes('FROM Opportunity')) return HttpResponse.json(opportunitiesFixture);
    return HttpResponse.json({ totalSize: 0, done: true, records: [] });
  }),
  http.get(`${API_BASE}/limits`, () => HttpResponse.json({ DailyApiRequests: { Max: 5000, Remaining: 4999 } })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeConnector(): SalesforceConnector {
  const connector = new SalesforceConnector();
  connector.setTokens(VALID_TOKENS);
  return connector;
}

describe('SalesforceConnector', () => {
  describe('connect()', () => {
    it('succeeds when tokens are set and valid', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ instanceUrl: INSTANCE_URL });
      expect(result.isOk()).toBe(true);
    });

    it('fails when no tokens are set', async () => {
      const connector = new SalesforceConnector();
      const result = await connector.connect({ instanceUrl: INSTANCE_URL });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('AUTH_MISSING');
    });

    it('fails when config is invalid (bad instanceUrl)', async () => {
      const connector = makeConnector();
      const result = await connector.connect({ instanceUrl: 'not-a-url' });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('INVALID_CONFIG');
    });
  });

  describe('sync() — contacts', () => {
    it('yields contact entities with correct shape', async () => {
      const connector = makeConnector();
      const entities: Awaited<ReturnType<typeof assertEntityShape>>[] = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        assertEntityShape(entity);
        entities.push(entity as never);
      }
      expect(entities).toHaveLength(2);
    });

    it('maps contact fields to SemanticEntity attributes', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      const alice = entities.find((e) => e.id === 'salesforce:contact:c001');
      expect(alice).toBeDefined();
      expect(alice?.label).toBe('Alice Smith');
      expect(alice?.attributes['email']).toBe('alice@example.com');
      expect(alice?.relationships).toHaveLength(1);
      expect(alice?.relationships[0]?.targetId).toBe('salesforce:account:a001');
    });

    it('handles contacts with null fields', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      const jones = entities.find((e) => e.id === 'salesforce:contact:c002');
      expect(jones).toBeDefined();
      expect(jones?.label).toBe('Jones');
      expect(jones?.relationships).toHaveLength(0);
    });
  });

  describe('sync() — accounts', () => {
    it('yields account entities with correct shape', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['account'] })) {
        assertEntityShape(entity);
        entities.push(entity);
      }
      expect(entities).toHaveLength(1);
      expect(entities[0]?.type).toBe('account');
      expect(entities[0]?.label).toBe('Acme Corp');
      expect(entities[0]?.attributes['industry']).toBe('Technology');
    });
  });

  describe('sync() — opportunities', () => {
    it('yields opportunity entities with correct shape', async () => {
      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['opportunity'] })) {
        assertEntityShape(entity);
        entities.push(entity);
      }
      expect(entities).toHaveLength(1);
      expect(entities[0]?.type).toBe('opportunity');
      expect(entities[0]?.attributes['stage']).toBe('Proposal/Price Quote');
      expect(entities[0]?.attributes['amount']).toBe(75_000);
      expect(entities[0]?.relationships[0]?.targetId).toBe('salesforce:account:a001');
    });
  });

  describe('sync() — pagination', () => {
    it('follows nextRecordsUrl to fetch all pages', async () => {
      server.use(
        http.get(`${API_BASE}/query`, ({ request }) => {
          const q = new URL(request.url).searchParams.get('q') ?? '';
          if (q.includes('FROM Contact')) {
            return HttpResponse.json({
              totalSize: 2,
              done: false,
              nextRecordsUrl: '/services/data/v57.0/query/next-page',
              records: [contactsFixture.records[0]],
            });
          }
          return HttpResponse.json({ totalSize: 0, done: true, records: [] });
        }),
        http.get(`${INSTANCE_URL}/services/data/v57.0/query/next-page`, () =>
          HttpResponse.json({
            totalSize: 2,
            done: true,
            records: [contactsFixture.records[1]],
          }),
        ),
      );

      const connector = makeConnector();
      const entities = [];
      for await (const entity of connector.sync({ entityTypes: ['contact'] })) {
        entities.push(entity);
      }
      expect(entities).toHaveLength(2);
    });
  });

  describe('sync() — API error', () => {
    it('throws ConnectorError on non-2xx response', async () => {
      server.use(
        http.get(`${API_BASE}/query`, () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })),
      );
      const connector = makeConnector();
      await expect(async () => {
        for await (const _ of connector.sync({ entityTypes: ['contact'] })) {
          // consume
        }
      }).rejects.toMatchObject({ code: 'API_ERROR' });
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy:true when limits endpoint succeeds', async () => {
      const connector = makeConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(true);
    });

    it('returns healthy:false when no tokens are set', async () => {
      const connector = new SalesforceConnector();
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
    });
  });

  describe('getSchema()', () => {
    it('returns schema with contact, account, opportunity types', async () => {
      const connector = makeConnector();
      const schema = await connector.getSchema();
      const typeNames = schema.entityTypes.map((t) => t.name);
      expect(typeNames).toContain('contact');
      expect(typeNames).toContain('account');
      expect(typeNames).toContain('opportunity');
    });
  });
});
