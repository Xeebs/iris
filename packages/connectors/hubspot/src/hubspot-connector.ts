import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { fetchFixturePage } from './demo-fixture-client.js';
import { transformContact, transformCompany, transformDeal } from './transformers.js';
import type { HubSpotContact, HubSpotCompany, HubSpotDeal } from './transformers.js';

export { manifest };

const configSchema = z.object({ portalId: z.string().min(1), demoMode: z.boolean().optional() });
export type HubSpotConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface HubSpotListResponse<T> {
  results: T[];
  paging?: { next?: { after: string } };
}

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const REQUEST_TIMEOUT_MS = 10_000;
const CONTACT_PROPERTIES = ['firstname', 'lastname', 'email', 'company', 'phone', 'lifecyclestage', 'hubspot_owner_id', 'hs_lead_status', 'lastmodifieddate', 'associatedcompanyid'];
const COMPANY_PROPERTIES = ['name', 'domain', 'industry', 'city', 'country', 'numberofemployees', 'annualrevenue', 'hs_lastmodifieddate', 'hubspot_owner_id'];
const DEAL_PROPERTIES = ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hs_lastmodifieddate', 'hubspot_owner_id', 'associatedcompanyid'];

export class HubSpotConnector extends BaseConnector<HubSpotConfig> {
  private tokens: OAuthTokens | null = null;
  private demoMode = false;
  private readonly log = logger.child({ connector: 'hubspot' });

  /**
   * @param config - Workspace-level config with portalId (and optional demoMode)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: HubSpotConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid HubSpot config: portalId is required', 'INVALID_CONFIG', false));
    }

    if (parsed.data.demoMode === true) {
      // Fixture-backed mode — no OAuth, no network; get() serves local fixtures.
      this.demoMode = true;
      this.log.info('Connected to HubSpot in demo mode (fixtures)', { portalId: parsed.data.portalId });
      return ok(undefined);
    }

    if (!this.tokens) {
      return err(new ConnectorError(
        'No OAuth tokens available. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    const now = new Date();
    if (this.tokens.expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      const refreshResult = await this.refreshTokens();
      if (refreshResult.isErr()) return err(refreshResult.error);
    }

    this.log.info('Connected to HubSpot', { portalId: parsed.data.portalId });
    return ok(undefined);
  }

  /** Inject tokens directly (used in tests and OAuth callback handlers). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * @param options - Sync options including lastSyncedAt cursor and entityTypes filter
   * @returns AsyncGenerator yielding SemanticEntity objects
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const types = options.entityTypes ?? ['contact', 'company', 'deal'];

    if (types.includes('contact')) {
      yield* this.syncContacts(options);
    }
    if (types.includes('company')) {
      yield* this.syncCompanies(options);
    }
    if (types.includes('deal')) {
      yield* this.syncDeals(options);
    }
  }

  private async *syncContacts(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    let after: string | undefined;
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: CONTACT_PROPERTIES.join(','),
      });
      if (after) params.set('after', after);
      if (options.lastSyncedAt) {
        params.set('filterGroups[0][filters][0][propertyName]', 'lastmodifieddate');
        params.set('filterGroups[0][filters][0][operator]', 'GTE');
        params.set('filterGroups[0][filters][0][value]', options.lastSyncedAt.toISOString());
      }

      const data = await this.get<HubSpotListResponse<HubSpotContact>>(`/crm/v3/objects/contacts?${params}`);
      pageCount++;
      this.log.debug('Synced contact page', { page: pageCount, count: data.results.length });

      for (const contact of data.results) {
        yield transformContact(contact);
      }

      after = data.paging?.next?.after;
    } while (after);
  }

  private async *syncCompanies(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    let after: string | undefined;

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: COMPANY_PROPERTIES.join(','),
      });
      if (after) params.set('after', after);

      const data = await this.get<HubSpotListResponse<HubSpotCompany>>(`/crm/v3/objects/companies?${params}`);

      for (const company of data.results) {
        yield transformCompany(company);
      }

      after = data.paging?.next?.after;
    } while (after);
  }

  private async *syncDeals(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    let after: string | undefined;

    do {
      const params = new URLSearchParams({
        limit: '100',
        properties: DEAL_PROPERTIES.join(','),
      });
      if (after) params.set('after', after);

      const data = await this.get<HubSpotListResponse<HubSpotDeal>>(`/crm/v3/objects/deals?${params}`);

      for (const deal of data.results) {
        yield transformDeal(deal);
      }

      after = data.paging?.next?.after;
    } while (after);
  }

  /**
   * @returns ConnectorSchema describing all entity types and their attributes
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'contact',
          attributes: [
            { name: 'company', type: 'string', nullable: true },
            { name: 'stage', type: 'string', nullable: true },
            { name: 'leadStatus', type: 'string', nullable: true },
            { name: 'owner', type: 'string', nullable: true },
            { name: 'phone', type: 'string', nullable: true, pii: true },
          ],
        },
        {
          name: 'company',
          attributes: [
            { name: 'domain', type: 'string', nullable: true },
            { name: 'industry', type: 'string', nullable: true },
            { name: 'city', type: 'string', nullable: true },
            { name: 'country', type: 'string', nullable: true },
            { name: 'employees', type: 'number', nullable: true },
            { name: 'revenue', type: 'number', nullable: true },
            { name: 'owner', type: 'string', nullable: true },
          ],
        },
        {
          name: 'deal',
          attributes: [
            { name: 'amount', type: 'number', nullable: true },
            { name: 'stage', type: 'string', nullable: true },
            { name: 'pipeline', type: 'string', nullable: true },
            { name: 'closeDate', type: 'date', nullable: true },
            { name: 'owner', type: 'string', nullable: true },
          ],
        },
      ],
      version: manifest.id + '@1.0.0',
    };
  }

  /**
   * @returns HealthStatus with latency measurement
   */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.get('/crm/v3/objects/contacts?limit=1');
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
        checkedAt: new Date(),
      };
    }
  }

  private async get<T>(path: string): Promise<T> {
    if (this.demoMode) {
      return fetchFixturePage<T>(path);
    }

    if (!this.tokens) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError('HubSpot auth failed — token may be expired', 'AUTH_EXPIRED', true);
      }
      if (response.status === 429) {
        throw new ConnectorError('HubSpot rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new ConnectorError(`HubSpot API error: ${response.status} ${response.statusText}`, 'API_ERROR', response.status >= 500);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshTokens(): Promise<Result<void, ConnectorError>> {
    if (!this.tokens) {
      return err(new ConnectorError('No tokens to refresh', 'AUTH_MISSING', false));
    }
    // In production this would call the HubSpot token refresh endpoint.
    // For now, return an error indicating the refresh must be handled externally.
    return err(new ConnectorError('Token refresh required — re-authenticate via OAuth', 'TOKEN_REFRESH_REQUIRED', false));
  }
}
