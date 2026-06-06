import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformCustomer, transformVendor, transformInvoice, transformExpense } from './transformers.js';
import type { QBCustomer, QBVendor, QBInvoice, QBExpense } from './transformers.js';

export { manifest };

const configSchema = z.object({
  realmId: z.string().min(1),
});
export type QuickBooksConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const QB_API_BASE = 'https://quickbooks.api.intuit.com';
const QB_AUTH_BASE = 'https://oauth.platform.intuit.com/oauth2/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;

type QBQueryResponse<K extends string, T> = {
  QueryResponse: Record<K, T[]> & {
    startPosition: number;
    maxResults: number;
    totalCount?: number;
  };
};

export class QuickBooksConnector extends BaseConnector<QuickBooksConfig> {
  private tokens: OAuthTokens | null = null;
  private realmId: string | null = null;
  private readonly log = logger.child({ connector: 'quickbooks' });

  /**
   * @param config - Workspace-level config with realmId (QuickBooks company ID)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: QuickBooksConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid QuickBooks config: realmId is required', 'INVALID_CONFIG', false));
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

    this.realmId = parsed.data.realmId;
    this.log.info('QuickBooks connector connected', { realmId: this.realmId });
    return ok(undefined);
  }

  /** Provide OAuth tokens externally (called by OAuth callback handler). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * Sync customers, vendors, invoices, and expenses as SemanticEntity objects.
   * Uses LastUpdatedTime/TxnDate filter for incremental sync.
   *
   * @param options - SyncOptions with optional lastSyncedAt cursor
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.tokens || !this.realmId) {
      throw new ConnectorError('Connector not connected. Call connect() first.', 'NOT_CONNECTED', false);
    }

    const updatedSince = options.lastSyncedAt
      ? new Date(options.lastSyncedAt).toISOString()
      : null;

    yield* this.syncEntity<QBCustomer>('Customer', 'MetaData.LastUpdatedTime', updatedSince, transformCustomer);
    yield* this.syncEntity<QBVendor>('Vendor', 'MetaData.LastUpdatedTime', updatedSince, transformVendor);
    yield* this.syncEntity<QBInvoice>('Invoice', 'MetaData.LastUpdatedTime', updatedSince, transformInvoice);
    yield* this.syncEntity<QBExpense>('Purchase', 'MetaData.LastUpdatedTime', updatedSince, transformExpense);
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'customer',
          attributes: [
            { name: 'companyName', type: 'string', nullable: true },
            { name: 'active', type: 'boolean', nullable: false },
            { name: 'balance', type: 'number', nullable: true },
            { name: 'currency', type: 'string', nullable: true },
          ],
        },
        {
          name: 'vendor',
          attributes: [
            { name: 'companyName', type: 'string', nullable: true },
            { name: 'active', type: 'boolean', nullable: false },
            { name: 'balance', type: 'number', nullable: true },
            { name: 'currency', type: 'string', nullable: true },
          ],
        },
        {
          name: 'invoice',
          attributes: [
            { name: 'totalAmount', type: 'number', nullable: false },
            { name: 'balance', type: 'number', nullable: false },
            { name: 'txnDate', type: 'string', nullable: false },
            { name: 'dueDate', type: 'string', nullable: true },
            { name: 'currency', type: 'string', nullable: true },
            { name: 'emailStatus', type: 'string', nullable: true },
          ],
        },
        {
          name: 'expense',
          attributes: [
            { name: 'paymentType', type: 'string', nullable: true },
            { name: 'totalAmount', type: 'number', nullable: false },
            { name: 'txnDate', type: 'string', nullable: false },
            { name: 'currency', type: 'string', nullable: true },
          ],
        },
      ],
      version: `${manifest.id}@1.0.0`,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.tokens || !this.realmId) {
      return { healthy: false, error: 'Not connected', checkedAt: new Date() };
    }

    const start = Date.now();
    try {
      const url = `${QB_API_BASE}/v3/company/${this.realmId}/query?query=SELECT+COUNT(*)+FROM+CompanyInfo&minorversion=70`;
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

  private async *syncEntity<T>(
    entityType: string,
    dateField: string,
    updatedSince: string | null,
    transform: (record: T) => SemanticEntity,
  ): AsyncGenerator<SemanticEntity> {
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const whereClause = updatedSince
        ? ` WHERE ${dateField} > '${updatedSince}'`
        : '';
      const query = `SELECT * FROM ${entityType}${whereClause} ORDERBY ${dateField} ASC MAXRESULTS ${PAGE_SIZE} STARTPOSITION ${startPosition}`;

      const url = `${QB_API_BASE}/v3/company/${this.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
      const response = await this.fetchWithAuth(url);

      if (!response.ok) {
        throw new ConnectorError(
          `QuickBooks ${entityType} query failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as QBQueryResponse<typeof entityType, T>;
      const records = (body.QueryResponse[entityType] ?? []) as T[];

      for (const record of records) {
        yield transform(record);
      }

      hasMore = records.length === PAGE_SIZE;
      startPosition += records.length;
      if (records.length === 0) break;
    }

    this.log.info(`${entityType} sync complete`, { startPosition });
  }

  private async fetchWithAuth(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        const refreshResult = await this.refreshTokens();
        if (refreshResult.isErr()) throw refreshResult.error;

        return fetch(url, {
          headers: {
            Authorization: `Bearer ${this.tokens!.accessToken}`,
            Accept: 'application/json',
          },
        });
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshTokens(): Promise<Result<void, ConnectorError>> {
    if (!this.tokens) {
      return err(new ConnectorError('No tokens to refresh', 'AUTH_MISSING', false));
    }

    try {
      const clientId = process.env['QB_CLIENT_ID'] ?? '';
      const clientSecret = process.env['QB_CLIENT_SECRET'] ?? '';
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const response = await fetch(`${QB_AUTH_BASE}/tokens/bearer`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
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

      this.log.info('QuickBooks tokens refreshed');
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
