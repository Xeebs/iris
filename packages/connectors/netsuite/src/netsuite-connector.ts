import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformCustomer, transformVendor, transformItem, transformTransaction } from './transformers.js';
import type { NetSuiteCustomer, NetSuiteVendor, NetSuiteItem, NetSuiteTransaction } from './transformers.js';

export { manifest };

const configSchema = z.object({
  accountId: z.string().min(1),
});
export type NetSuiteConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;

type NetSuiteListResponse<T> = {
  items: T[];
  count: number;
  hasMore: boolean;
  offset: number;
  totalResults: number;
};

export class NetSuiteConnector extends BaseConnector<NetSuiteConfig> {
  private tokens: OAuthTokens | null = null;
  private accountId: string | null = null;
  private readonly log = logger.child({ connector: 'netsuite' });

  /**
   * @param config - Workspace-level config with accountId
   * @returns Result<void, ConnectorError>
   */
  async connect(config: NetSuiteConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid NetSuite config: accountId is required', 'INVALID_CONFIG', false));
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
      const refreshResult = await this.refreshTokens(parsed.data.accountId);
      if (refreshResult.isErr()) return err(refreshResult.error);
    }

    this.accountId = parsed.data.accountId;
    this.log.info('NetSuite connector connected', { accountId: this.accountId });
    return ok(undefined);
  }

  /** Provide OAuth tokens externally (called by OAuth callback handler). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * Sync customers, vendors, items, and transactions as SemanticEntity objects.
   * Uses lastModifiedDate filter for incremental sync.
   *
   * @param options - SyncOptions with optional lastSyncedAt cursor
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.tokens || !this.accountId) {
      throw new ConnectorError('Connector not connected. Call connect() first.', 'NOT_CONNECTED', false);
    }

    const lastModifiedAfter = options.lastSyncedAt
      ? new Date(options.lastSyncedAt).toISOString()
      : null;

    yield* this.syncRecordType<NetSuiteCustomer>('customer', transformCustomer, lastModifiedAfter);
    yield* this.syncRecordType<NetSuiteVendor>('vendor', transformVendor, lastModifiedAfter);
    yield* this.syncRecordType<NetSuiteItem>('inventoryItem', transformItem, lastModifiedAfter);
    yield* this.syncRecordType<NetSuiteTransaction>('transaction', transformTransaction, lastModifiedAfter);
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'customer',
          attributes: [
            { name: 'entityId', type: 'string', nullable: false },
            { name: 'subsidiary', type: 'string', nullable: true },
            { name: 'status', type: 'string', nullable: true },
          ],
        },
        {
          name: 'vendor',
          attributes: [
            { name: 'entityId', type: 'string', nullable: false },
            { name: 'subsidiary', type: 'string', nullable: true },
          ],
        },
        {
          name: 'item',
          attributes: [
            { name: 'itemId', type: 'string', nullable: false },
            { name: 'itemType', type: 'string', nullable: false },
            { name: 'description', type: 'string', nullable: true },
            { name: 'basePrice', type: 'number', nullable: true },
            { name: 'subsidiary', type: 'string', nullable: true },
          ],
        },
        {
          name: 'transaction',
          attributes: [
            { name: 'transactionType', type: 'string', nullable: false },
            { name: 'status', type: 'string', nullable: true },
            { name: 'amount', type: 'number', nullable: true },
            { name: 'currency', type: 'string', nullable: true },
            { name: 'tranDate', type: 'string', nullable: false },
          ],
        },
      ],
      version: `${manifest.id}@1.0.0`,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.tokens || !this.accountId) {
      return { healthy: false, error: 'Not connected', checkedAt: new Date() };
    }

    const start = Date.now();
    try {
      const url = `${this.apiBase()}/record/v1/customer?limit=1`;
      const response = await this.fetchWithAuth(url);
      if (response.ok) {
        return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
      }
      return {
        healthy: false,
        error: `Health check failed: HTTP ${response.status}`,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      };
    } catch (e) {
      return {
        healthy: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      };
    }
  }

  private apiBase(): string {
    return `https://${this.accountId}.suitetalk.api.netsuite.com/services/rest`;
  }

  private async *syncRecordType<T>(
    recordType: string,
    transform: (record: T) => SemanticEntity,
    lastModifiedAfter: string | null,
  ): AsyncGenerator<SemanticEntity> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(`${this.apiBase()}/record/v1/${recordType}`);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(offset));
      if (lastModifiedAfter) {
        url.searchParams.set('q', `lastModifiedDate AFTER "${lastModifiedAfter}"`);
      }

      const response = await this.fetchWithAuth(url.toString());

      if (!response.ok) {
        throw new ConnectorError(
          `NetSuite ${recordType} list failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as NetSuiteListResponse<T>;

      for (const record of body.items) {
        yield transform(record);
      }

      hasMore = body.hasMore;
      offset += body.items.length;
      if (body.items.length === 0) break;
    }

    this.log.info(`${recordType} sync complete`, { offset });
  }

  private async fetchWithAuth(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        const refreshResult = await this.refreshTokens(this.accountId!);
        if (refreshResult.isErr()) throw refreshResult.error;

        return fetch(url, {
          headers: {
            Authorization: `Bearer ${this.tokens!.accessToken}`,
            'Content-Type': 'application/json',
          },
        });
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshTokens(accountId: string): Promise<Result<void, ConnectorError>> {
    if (!this.tokens) {
      return err(new ConnectorError('No tokens to refresh', 'AUTH_MISSING', false));
    }

    try {
      const tokenUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          client_id: process.env['NETSUITE_CLIENT_ID'] ?? '',
          client_secret: process.env['NETSUITE_CLIENT_SECRET'] ?? '',
        }),
      });

      if (!response.ok) {
        return err(new ConnectorError('Token refresh failed', 'AUTH_REFRESH_FAILED', false));
      }

      const body = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
      this.tokens = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: new Date(Date.now() + body.expires_in * 1000),
      };

      this.log.info('NetSuite tokens refreshed');
      return ok(undefined);
    } catch (e) {
      return err(new ConnectorError(
        `Token refresh error: ${e instanceof Error ? e.message : String(e)}`,
        'AUTH_REFRESH_FAILED',
        true,
      ));
    }
  }
}
