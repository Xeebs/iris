import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import {
  transformContact,
  transformAccount,
  transformOpportunity,
} from './transformers.js';
import type {
  SalesforceContact,
  SalesforceAccount,
  SalesforceOpportunity,
} from './transformers.js';

export { manifest };

const configSchema = z.object({ instanceUrl: z.string().url() });
export type SalesforceConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  expiresAt: Date;
}

interface SalesforceQueryResponse<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

const SF_API_VERSION = 'v57.0';
const REQUEST_TIMEOUT_MS = 10_000;

const CONTACT_FIELDS =
  'Id,FirstName,LastName,Email,Phone,Title,AccountId,OwnerId,LeadSource,LastModifiedDate';
const ACCOUNT_FIELDS =
  'Id,Name,Industry,Website,Phone,BillingCity,BillingCountry,NumberOfEmployees,AnnualRevenue,OwnerId,LastModifiedDate';
const OPPORTUNITY_FIELDS =
  'Id,Name,AccountId,StageName,Amount,CloseDate,Probability,OwnerId,LeadSource,LastModifiedDate';

export class SalesforceConnector extends BaseConnector<SalesforceConfig> {
  private tokens: OAuthTokens | null = null;
  private readonly log = logger.child({ connector: 'salesforce' });

  /**
   * @param config - Workspace-level config with instanceUrl
   * @returns Result<void, ConnectorError>
   */
  async connect(config: SalesforceConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Salesforce config: instanceUrl is required', 'INVALID_CONFIG', false));
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

    this.log.info('Connected to Salesforce', { instanceUrl: parsed.data.instanceUrl });
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
    const types = options.entityTypes ?? ['contact', 'account', 'opportunity'];

    if (types.includes('contact')) {
      yield* this.syncContacts(options);
    }
    if (types.includes('account')) {
      yield* this.syncAccounts(options);
    }
    if (types.includes('opportunity')) {
      yield* this.syncOpportunities(options);
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'contact',
          attributes: [
            { name: 'email', type: 'string' },
            { name: 'phone', type: 'string' },
            { name: 'title', type: 'string' },
            { name: 'leadSource', type: 'string' },
            { name: 'ownerId', type: 'string' },
          ],
        },
        {
          name: 'account',
          attributes: [
            { name: 'industry', type: 'string' },
            { name: 'website', type: 'string' },
            { name: 'employees', type: 'number' },
            { name: 'annualRevenue', type: 'number' },
            { name: 'city', type: 'string' },
            { name: 'country', type: 'string' },
          ],
        },
        {
          name: 'opportunity',
          attributes: [
            { name: 'stage', type: 'string' },
            { name: 'amount', type: 'number' },
            { name: 'closeDate', type: 'string' },
            { name: 'probability', type: 'number' },
            { name: 'leadSource', type: 'string' },
          ],
        },
      ],
      version: '1.0.0',
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.tokens) {
      return { healthy: false, message: 'No OAuth tokens — connect() has not been called' };
    }
    try {
      const url = `${this.tokens.instanceUrl}/services/data/${SF_API_VERSION}/limits`;
      const res = await this.fetchWithAuth(url);
      if (res.ok) return { healthy: true };
      return { healthy: false, message: `Salesforce returned ${res.status}` };
    } catch (e) {
      return { healthy: false, message: String(e) };
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async *syncContacts(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const cursor = options.lastSyncedAt
      ? `AND LastModifiedDate > ${options.lastSyncedAt.toISOString()}`
      : '';
    const soql = `SELECT ${CONTACT_FIELDS} FROM Contact WHERE IsDeleted = false ${cursor} ORDER BY LastModifiedDate ASC`;

    for await (const contact of this.queryAll<SalesforceContact>(soql)) {
      yield transformContact(contact);
    }
  }

  private async *syncAccounts(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const cursor = options.lastSyncedAt
      ? `AND LastModifiedDate > ${options.lastSyncedAt.toISOString()}`
      : '';
    const soql = `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE IsDeleted = false ${cursor} ORDER BY LastModifiedDate ASC`;

    for await (const account of this.queryAll<SalesforceAccount>(soql)) {
      yield transformAccount(account);
    }
  }

  private async *syncOpportunities(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const cursor = options.lastSyncedAt
      ? `AND LastModifiedDate > ${options.lastSyncedAt.toISOString()}`
      : '';
    const soql = `SELECT ${OPPORTUNITY_FIELDS} FROM Opportunity WHERE IsDeleted = false ${cursor} ORDER BY LastModifiedDate ASC`;

    for await (const opp of this.queryAll<SalesforceOpportunity>(soql)) {
      yield transformOpportunity(opp);
    }
  }

  private async *queryAll<T>(soql: string): AsyncGenerator<T> {
    if (!this.tokens) throw new ConnectorError('Not connected', 'NOT_CONNECTED', false);

    const instanceUrl = this.tokens.instanceUrl;
    let url: string | null =
      `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    while (url) {
      const res = await this.fetchWithAuth(url);
      if (!res.ok) {
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        throw new ConnectorError(
          `Salesforce query failed: ${res.status} ${body}`,
          'API_ERROR',
          retryable,
        );
      }

      const data = (await res.json()) as SalesforceQueryResponse<T>;
      for (const record of data.records) {
        yield record;
      }

      url = data.done
        ? null
        : data.nextRecordsUrl
          ? `${instanceUrl}${data.nextRecordsUrl}`
          : null;
    }
  }

  private async fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.tokens) throw new ConnectorError('Not connected', 'NOT_CONNECTED', false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshTokens(): Promise<Result<void, ConnectorError>> {
    if (!this.tokens) return err(new ConnectorError('No tokens to refresh', 'AUTH_MISSING', false));

    try {
      const res = await fetch('https://login.salesforce.com/services/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          client_id: process.env['SALESFORCE_CLIENT_ID'] ?? '',
          client_secret: process.env['SALESFORCE_CLIENT_SECRET'] ?? '',
        }),
      });

      if (!res.ok) {
        return err(new ConnectorError(`Token refresh failed: ${res.status}`, 'AUTH_REFRESH_FAILED', false));
      }

      const data = (await res.json()) as { access_token: string; instance_url: string };
      this.tokens = {
        ...this.tokens,
        accessToken: data.access_token,
        instanceUrl: data.instance_url,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      };

      this.log.info('Tokens refreshed');
      return ok(undefined);
    } catch (e) {
      return err(new ConnectorError(String(e), 'AUTH_REFRESH_FAILED', true));
    }
  }
}
