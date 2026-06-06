import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformSpace, transformPage } from './transformers.js';
import type { ConfluenceSpace, ConfluencePage } from './transformers.js';

export { manifest };

const configSchema = z.object({ cloudId: z.string().min(1) });
export type ConfluenceConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const ATLASSIAN_API_BASE = 'https://api.atlassian.com';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;

export class ConfluenceConnector extends BaseConnector<ConfluenceConfig> {
  private tokens: OAuthTokens | null = null;
  private cloudId: string | null = null;
  private readonly log = logger.child({ connector: 'confluence' });

  /**
   * @param config - Workspace-level config with cloudId
   * @returns Result<void, ConnectorError>
   */
  async connect(config: ConfluenceConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Confluence config: cloudId is required', 'INVALID_CONFIG', false));
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

    this.cloudId = parsed.data.cloudId;
    this.log.info('Confluence connector connected', { cloudId: this.cloudId });
    return ok(undefined);
  }

  /** Provide OAuth tokens externally (called by OAuth callback handler). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * Sync spaces and pages as SemanticEntity objects.
   * Incremental sync uses CQL lastModified cursor for pages.
   *
   * @param options - SyncOptions with optional lastSyncedAt cursor
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.tokens || !this.cloudId) {
      throw new ConnectorError('Connector not connected. Call connect() first.', 'NOT_CONNECTED', false);
    }

    // Sync spaces first (no incremental cursor — space list is typically small)
    yield* this.syncSpaces();

    // Sync pages with CQL incremental cursor
    const updatedAfter = options.lastSyncedAt
      ? new Date(options.lastSyncedAt).toISOString().slice(0, 10)
      : null;
    yield* this.syncPages(updatedAfter);
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'space',
          attributes: [
            { name: 'key', type: 'string', nullable: false },
            { name: 'spaceType', type: 'string', nullable: false },
            { name: 'description', type: 'string', nullable: true },
          ],
        },
        {
          name: 'page',
          attributes: [
            { name: 'space', type: 'string', nullable: false },
            { name: 'author', type: 'string', nullable: true },
            { name: 'labels', type: 'string', nullable: true },
            { name: 'version', type: 'number', nullable: false },
          ],
        },
      ],
      version: `${manifest.id}@1.0.0`,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.tokens || !this.cloudId) {
      return { healthy: false, error: 'Not connected', checkedAt: new Date() };
    }

    const start = Date.now();
    try {
      const response = await this.fetchWithAuth(
        `${ATLASSIAN_API_BASE}/ex/confluence/${this.cloudId}/wiki/rest/api/space?limit=1`,
      );
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

  private async *syncSpaces(): AsyncGenerator<SemanticEntity> {
    let start = 0;
    let total = Infinity;

    while (start < total) {
      const url = `${ATLASSIAN_API_BASE}/ex/confluence/${this.cloudId}/wiki/rest/api/space?start=${start}&limit=${PAGE_SIZE}&expand=description.plain,homepage&type=global`;
      const response = await this.fetchWithAuth(url);

      if (!response.ok) {
        throw new ConnectorError(
          `Confluence space list failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as { results: ConfluenceSpace[]; size: number; start: number; limit: number; _links?: { next?: string } };
      total = body.size < body.limit ? start + body.size : Infinity;

      for (const space of body.results) {
        yield transformSpace(space);
      }

      if (body.results.length < PAGE_SIZE) break;
      start += body.results.length;
    }

    this.log.info('Space sync complete', { start });
  }

  private async *syncPages(updatedAfter: string | null): AsyncGenerator<SemanticEntity> {
    const cql = updatedAfter
      ? `type=page AND lastModified >= "${updatedAfter}" ORDER BY lastModified ASC`
      : 'type=page ORDER BY lastModified ASC';

    const expand = 'version,ancestors,metadata.labels,space';
    let startAt = 0;
    let total = Infinity;

    while (startAt < total) {
      const url = new URL(`${ATLASSIAN_API_BASE}/ex/confluence/${this.cloudId}/wiki/rest/api/content/search`);
      url.searchParams.set('cql', cql);
      url.searchParams.set('start', String(startAt));
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('expand', expand);

      const response = await this.fetchWithAuth(url.toString());

      if (!response.ok) {
        throw new ConnectorError(
          `Confluence page search failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as { results: ConfluencePage[]; size: number; totalSize: number };
      total = body.totalSize;

      for (const page of body.results) {
        yield transformPage(page);
      }

      startAt += body.results.length;
      if (body.results.length === 0) break;
    }

    this.log.info('Page sync complete', { total });
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
      const response = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          client_id: process.env['CONFLUENCE_CLIENT_ID'],
          client_secret: process.env['CONFLUENCE_CLIENT_SECRET'],
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

      this.log.info('Confluence tokens refreshed');
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
