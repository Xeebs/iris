import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorMarketplaceService } from '../connector-marketplace.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const LISTING_ROW = {
  id: 'listing-1',
  connector_id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, companies, deals',
  category: 'crm',
  icon_url: null,
  documentation_url: null,
  author: 'Iris Team',
  version: '1.0.0',
  is_official: true,
  is_published: true,
  popularity_score: 0.8,
  workspace_installs_count: 42,
  published_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  avg_rating: 4.2,
};

const REVIEW_ROW = {
  id: 'rev-1',
  listing_id: 'listing-1',
  reviewer_id: 'user-1',
  rating: 5,
  comment: 'Great connector!',
  created_at: '2026-06-07T00:00:00Z',
  avg_rating: 5.0,
};

function makeService(sql: ReturnType<typeof vi.fn>) {
  return new ConnectorMarketplaceService(sql as unknown as ConstructorParameters<typeof ConnectorMarketplaceService>[0]);
}

describe('ConnectorMarketplaceService', () => {
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getListings', () => {
    it('returns paginated listings', async () => {
      sql = vi.fn(async () => [LISTING_ROW]);
      const svc = makeService(sql);
      const result = await svc.getListings();
      expect(result.isOk()).toBe(true);
      const { listings, hasMore } = result._unsafeUnwrap();
      expect(listings).toHaveLength(1);
      expect(listings[0]!.connectorId).toBe('hubspot');
      expect(hasMore).toBe(false);
    });

    it('sets hasMore when results exceed limit', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({ ...LISTING_ROW, id: `l-${i}` }));
      sql = vi.fn(async () => rows);
      const svc = makeService(sql);
      const result = await svc.getListings({ limit: 3 });
      expect(result.isOk()).toBe(true);
      const { hasMore, nextCursor } = result._unsafeUnwrap();
      expect(hasMore).toBe(true);
      expect(nextCursor).toBeTruthy();
    });

    it('filters by category', async () => {
      sql = vi.fn(async () => [LISTING_ROW]);
      const svc = makeService(sql);
      const result = await svc.getListings({ category: 'crm' });
      expect(result.isOk()).toBe(true);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.getListings();
      expect(result.isErr()).toBe(true);
    });
  });

  describe('installConnector', () => {
    it('records install and bumps counter', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 'listing-1' }]; // find listing
        if (call === 2) return []; // insert install
        return []; // update counter
      });
      const svc = makeService(sql);
      const result = await svc.installConnector('ws-1', 'hubspot');
      expect(result.isOk()).toBe(true);
      expect(call).toBe(3);
    });

    it('returns err when connector not found', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.installConnector('ws-1', 'unknown');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });
  });

  describe('submitConnector', () => {
    it('upserts a listing and returns it', async () => {
      sql = vi.fn(async () => [LISTING_ROW]);
      const svc = makeService(sql);
      const result = await svc.submitConnector({
        connectorId: 'hubspot',
        name: 'HubSpot',
        description: 'CRM connector',
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().connectorId).toBe('hubspot');
    });
  });

  describe('curateListing', () => {
    it('publishes a connector listing', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.curateListing('hubspot', true);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('rateConnector', () => {
    it('upserts a review and returns it', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 'listing-1' }]; // find listing
        if (call === 2) return [REVIEW_ROW]; // upsert review
        return []; // update popularity (non-fatal)
      });
      const svc = makeService(sql);
      const result = await svc.rateConnector('hubspot', 'user-1', 5, 'Great!');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().rating).toBe(5);
    });

    it('returns err for out-of-range rating', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.rateConnector('hubspot', 'user-1', 6);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('between 1 and 5');
    });

    it('returns err when connector not found', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.rateConnector('unknown', 'user-1', 4);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getRatings', () => {
    it('returns reviews and average rating', async () => {
      sql = vi.fn(async () => [REVIEW_ROW]);
      const svc = makeService(sql);
      const result = await svc.getRatings('hubspot');
      expect(result.isOk()).toBe(true);
      const { reviews, avgRating } = result._unsafeUnwrap();
      expect(reviews).toHaveLength(1);
      expect(avgRating).toBe(5.0);
    });

    it('returns empty reviews when none exist', async () => {
      sql = vi.fn(async () => []);
      const svc = makeService(sql);
      const result = await svc.getRatings('hubspot');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().reviews).toHaveLength(0);
      expect(result._unsafeUnwrap().avgRating).toBe(0);
    });
  });
});
