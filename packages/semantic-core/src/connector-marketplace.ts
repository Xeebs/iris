import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-marketplace' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectorListing = {
  id: string;
  connectorId: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  documentationUrl: string | null;
  author: string | null;
  version: string;
  isOfficial: boolean;
  isPublished: boolean;
  popularityScore: number;
  workspaceInstallsCount: number;
  publishedAt: Date | null;
  createdAt: Date;
};

export type ConnectorReview = {
  id: string;
  listingId: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
};

export type ListingsFilter = {
  category?: string;
  minRating?: number;
  sortBy?: 'popularity' | 'rating' | 'installs' | 'newest';
  cursor?: string;
  limit?: number;
};

export type SubmitListingOptions = {
  connectorId: string;
  name: string;
  description: string;
  category?: string;
  iconUrl?: string;
  documentationUrl?: string;
  author?: string;
  version?: string;
};

export type PaginatedListings = {
  listings: ConnectorListing[];
  nextCursor: string | null;
  hasMore: boolean;
};

// ─── ConnectorMarketplaceService ──────────────────────────────────────────────

/**
 * Manages connector discovery, ratings, and workspace installation tracking.
 */
export class ConnectorMarketplaceService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * List published connector listings with filtering and cursor-based pagination.
   *
   * @param filters - Optional filtering/sorting options
   * @returns Paginated listings
   */
  async getListings(filters: ListingsFilter = {}): Promise<Result<PaginatedListings, Error>> {
    try {
      const limit = Math.min(filters.limit ?? 50, 200);
      const category = filters.category ?? null;
      const minRating = filters.minRating ?? null;

      const rows = category
        ? (await this.sql`
            SELECT l.*, COALESCE(AVG(r.rating), 0) AS avg_rating
            FROM connector_listings l
            LEFT JOIN connector_reviews r ON l.id = r.listing_id
            WHERE l.is_published = true AND l.category = ${category}
            GROUP BY l.id
            HAVING COALESCE(AVG(r.rating), 0) >= COALESCE(${minRating}, 0)
            ORDER BY l.popularity_score DESC
            LIMIT ${limit + 1}
          ` as Record<string, unknown>[])
        : (await this.sql`
            SELECT l.*, COALESCE(AVG(r.rating), 0) AS avg_rating
            FROM connector_listings l
            LEFT JOIN connector_reviews r ON l.id = r.listing_id
            WHERE l.is_published = true
            GROUP BY l.id
            HAVING COALESCE(AVG(r.rating), 0) >= COALESCE(${minRating}, 0)
            ORDER BY l.popularity_score DESC
            LIMIT ${limit + 1}
          ` as Record<string, unknown>[]);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (page[page.length - 1]!['id'] as string) : null;

      return ok({ listings: page.map(mapListingRow), nextCursor, hasMore });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Install a connector for a workspace (records the install and bumps the counter).
   *
   * @param workspaceId - Tenant workspace
   * @param connectorId - Connector identifier (e.g. 'hubspot')
   */
  async installConnector(workspaceId: string, connectorId: string): Promise<Result<void, Error>> {
    try {
      const listingRows = await this.sql`
        SELECT id FROM connector_listings
        WHERE connector_id = ${connectorId} AND is_published = true
      ` as { id: string }[];

      if (listingRows.length === 0) return err(new Error('Connector listing not found'));
      const listingId = listingRows[0]!.id;

      await this.sql`
        INSERT INTO connector_installs (listing_id, workspace_id)
        VALUES (${listingId}, ${workspaceId})
        ON CONFLICT (listing_id, workspace_id) DO NOTHING
      `;

      await this.sql`
        UPDATE connector_listings
        SET workspace_installs_count = workspace_installs_count + 1,
            popularity_score = (workspace_installs_count * 0.4 + popularity_score * 0.6)
        WHERE id = ${listingId}
      `;

      log.info('Connector installed', { workspaceId, connectorId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Submit a new connector listing for publication.
   *
   * @param options - Listing metadata
   * @returns Created listing (not yet published — requires curation approval)
   */
  async submitConnector(options: SubmitListingOptions): Promise<Result<ConnectorListing, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO connector_listings (
          connector_id, name, description, category, icon_url,
          documentation_url, author, version
        )
        VALUES (
          ${options.connectorId}, ${options.name}, ${options.description},
          ${options.category ?? 'general'}, ${options.iconUrl ?? null},
          ${options.documentationUrl ?? null}, ${options.author ?? null},
          ${options.version ?? '1.0.0'}
        )
        ON CONFLICT (connector_id) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description,
          category = EXCLUDED.category, icon_url = EXCLUDED.icon_url,
          documentation_url = EXCLUDED.documentation_url,
          author = EXCLUDED.author, version = EXCLUDED.version,
          updated_at = now()
        RETURNING *
      ` as Record<string, unknown>[];
      return ok(mapListingRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Approve or reject a connector listing (admin action).
   *
   * @param connectorId - Connector identifier
   * @param publish - true to publish, false to unpublish
   */
  async curateListing(connectorId: string, publish: boolean): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE connector_listings
        SET is_published = ${publish},
            published_at = CASE WHEN ${publish} = true AND published_at IS NULL THEN now() ELSE published_at END,
            updated_at = now()
        WHERE connector_id = ${connectorId}
      `;
      log.info('Connector listing curated', { connectorId, publish });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Rate a connector listing.
   *
   * @param connectorId - Connector identifier
   * @param reviewerId - User submitting the review
   * @param rating - 1-5 star rating
   * @param comment - Optional review text
   */
  async rateConnector(
    connectorId: string,
    reviewerId: string,
    rating: number,
    comment?: string,
  ): Promise<Result<ConnectorReview, Error>> {
    try {
      if (rating < 1 || rating > 5) return err(new Error('Rating must be between 1 and 5'));

      const listingRows = await this.sql`
        SELECT id FROM connector_listings WHERE connector_id = ${connectorId}
      ` as { id: string }[];
      if (listingRows.length === 0) return err(new Error('Connector not found'));
      const listingId = listingRows[0]!.id;

      const rows = await this.sql`
        INSERT INTO connector_reviews (listing_id, reviewer_id, rating, comment)
        VALUES (${listingId}, ${reviewerId}, ${rating}, ${comment ?? null})
        ON CONFLICT (listing_id, reviewer_id) DO UPDATE SET
          rating = EXCLUDED.rating, comment = EXCLUDED.comment
        RETURNING *
      ` as Record<string, unknown>[];

      await this.updatePopularityScore(listingId);
      return ok(mapReviewRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get all reviews for a connector.
   *
   * @param connectorId - Connector identifier
   */
  async getRatings(connectorId: string): Promise<Result<{ reviews: ConnectorReview[]; avgRating: number }, Error>> {
    try {
      const rows = await this.sql`
        SELECT r.*, AVG(r.rating) OVER () AS avg_rating
        FROM connector_reviews r
        JOIN connector_listings l ON r.listing_id = l.id
        WHERE l.connector_id = ${connectorId}
        ORDER BY r.created_at DESC
        LIMIT 50
      ` as Record<string, unknown>[];

      const reviews = rows.map(mapReviewRow);
      const avgRating = rows.length > 0 ? Number(rows[0]!['avg_rating']) : 0;
      return ok({ reviews, avgRating });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async updatePopularityScore(listingId: string): Promise<void> {
    try {
      await this.sql`
        UPDATE connector_listings SET
          popularity_score = (
            SELECT (l.workspace_installs_count * 0.4 + COALESCE(AVG(r.rating), 0) * 0.3 +
                   (1.0 / (1 + EXTRACT(DAYS FROM (now() - l.created_at)) / 30.0)) * 0.3)
            FROM connector_listings l
            LEFT JOIN connector_reviews r ON l.id = r.listing_id
            WHERE l.id = ${listingId}
            GROUP BY l.workspace_installs_count, l.created_at
          ),
          updated_at = now()
        WHERE id = ${listingId}
      `;
    } catch {
      log.warn('Failed to update popularity score (non-fatal)', { listingId });
    }
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

function mapListingRow(r: Record<string, unknown>): ConnectorListing {
  return {
    id: r['id'] as string,
    connectorId: r['connector_id'] as string,
    name: r['name'] as string,
    description: r['description'] as string,
    category: r['category'] as string,
    iconUrl: r['icon_url'] as string | null,
    documentationUrl: r['documentation_url'] as string | null,
    author: r['author'] as string | null,
    version: r['version'] as string,
    isOfficial: r['is_official'] as boolean,
    isPublished: r['is_published'] as boolean,
    popularityScore: r['popularity_score'] as number,
    workspaceInstallsCount: r['workspace_installs_count'] as number,
    publishedAt: r['published_at'] ? new Date(r['published_at'] as string) : null,
    createdAt: new Date(r['created_at'] as string),
  };
}

function mapReviewRow(r: Record<string, unknown>): ConnectorReview {
  return {
    id: r['id'] as string,
    listingId: r['listing_id'] as string,
    reviewerId: r['reviewer_id'] as string,
    rating: r['rating'] as number,
    comment: r['comment'] as string | null,
    createdAt: new Date(r['created_at'] as string),
  };
}
