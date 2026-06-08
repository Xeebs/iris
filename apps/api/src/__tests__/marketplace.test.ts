import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/connector-marketplace', () => ({
  ConnectorMarketplaceService: vi.fn().mockImplementation(() => ({
    getListings: vi.fn(),
    installConnector: vi.fn(),
    rateConnector: vi.fn(),
    getRatings: vi.fn(),
    submitConnector: vi.fn(),
    curateListing: vi.fn(),
  })),
}));

import { ConnectorMarketplaceService } from '@iris/semantic-core/connector-marketplace';
import { createMarketplaceRoutes } from '../routes/marketplace.js';

const LISTING = {
  id: 'listing-1', connectorId: 'hubspot', name: 'HubSpot', description: 'CRM',
  category: 'crm', iconUrl: null, documentationUrl: null, author: 'Iris Team',
  version: '1.0.0', isOfficial: true, isPublished: true, popularityScore: 0.8,
  workspaceInstallsCount: 42, publishedAt: new Date(), createdAt: new Date(),
};

const REVIEW = {
  id: 'rev-1', listingId: 'listing-1', reviewerId: 'user-1',
  rating: 5, comment: 'Great!', createdAt: new Date(),
};

function makeApp(): { app: Hono; svc: ReturnType<typeof ConnectorMarketplaceService.prototype.getListings> & Record<string, ReturnType<typeof vi.fn>> } {
  const fakeSql = {} as Parameters<typeof createMarketplaceRoutes>[0];
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('workspaceId', 'ws-test'); await next(); });
  app.route('/api/v1/marketplace', createMarketplaceRoutes(fakeSql));
  const instance = vi.mocked(ConnectorMarketplaceService).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>;
  return { app, svc: instance };
}

describe('GET /api/v1/marketplace/connectors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated listings', async () => {
    const { app, svc } = makeApp();
    svc['getListings'].mockResolvedValue(ok({ listings: [LISTING], nextCursor: null, hasMore: false }));
    const res = await app.request('/api/v1/marketplace/connectors');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: typeof LISTING[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
  });

  it('forwards category and minRating filters', async () => {
    const { app, svc } = makeApp();
    svc['getListings'].mockResolvedValue(ok({ listings: [], nextCursor: null, hasMore: false }));
    await app.request('/api/v1/marketplace/connectors?category=crm&minRating=4');
    expect(svc['getListings']).toHaveBeenCalledWith(expect.objectContaining({ category: 'crm', minRating: 4 }));
  });

  it('returns 500 when service fails', async () => {
    const { app, svc } = makeApp();
    svc['getListings'].mockResolvedValue(err(new Error('db down')));
    const res = await app.request('/api/v1/marketplace/connectors');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/marketplace/connectors/:id/install', () => {
  beforeEach(() => vi.clearAllMocks());

  it('installs connector and returns 200', async () => {
    const { app, svc } = makeApp();
    svc['installConnector'].mockResolvedValue(ok(undefined));
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/install', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { installed: boolean } };
    expect(body.data.installed).toBe(true);
  });

  it('returns 404 when connector listing not found', async () => {
    const { app, svc } = makeApp();
    svc['installConnector'].mockResolvedValue(err(new Error('Connector listing not found')));
    const res = await app.request('/api/v1/marketplace/connectors/unknown/install', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/marketplace/connectors/:id/rate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits a rating and returns 201', async () => {
    const { app, svc } = makeApp();
    svc['rateConnector'].mockResolvedValue(ok(REVIEW));
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: 'user-1', rating: 5, comment: 'Great!' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: typeof REVIEW };
    expect(body.data.rating).toBe(5);
  });

  it('returns 400 for invalid body', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when connector not found', async () => {
    const { app, svc } = makeApp();
    svc['rateConnector'].mockResolvedValue(err(new Error('Connector not found')));
    const res = await app.request('/api/v1/marketplace/connectors/unknown/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: 'user-1', rating: 3 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/marketplace/connectors/:id/ratings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns reviews and avg rating', async () => {
    const { app, svc } = makeApp();
    svc['getRatings'].mockResolvedValue(ok({ reviews: [REVIEW], avgRating: 5 }));
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/ratings');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { avgRating: number; reviews: typeof REVIEW[] } };
    expect(body.data.avgRating).toBe(5);
    expect(body.data.reviews).toHaveLength(1);
  });
});

describe('POST /api/v1/marketplace/connectors (submit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new listing and returns 201', async () => {
    const { app, svc } = makeApp();
    svc['submitConnector'].mockResolvedValue(ok(LISTING));
    const res = await app.request('/api/v1/marketplace/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'hubspot', name: 'HubSpot', description: 'CRM connector' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 for missing required fields', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/marketplace/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HubSpot' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/v1/marketplace/connectors/:id/curate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes a connector listing', async () => {
    const { app, svc } = makeApp();
    svc['curateListing'].mockResolvedValue(ok(undefined));
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/curate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { published: boolean } };
    expect(body.data.published).toBe(true);
  });

  it('returns 400 for missing publish field', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/v1/marketplace/connectors/hubspot/curate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
