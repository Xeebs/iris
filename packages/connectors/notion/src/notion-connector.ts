import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformPage } from './transformers.js';
import type { NotionPage } from './transformers.js';

export { manifest };

const configSchema = z.object({});
export type NotionConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  expiresAt: Date;
}

interface NotionSearchResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2022-06-28';
const REQUEST_TIMEOUT_MS = 10_000;

export class NotionConnector extends BaseConnector<NotionConfig> {
  private tokens: OAuthTokens | null = null;
  private readonly log = logger.child({ connector: 'notion' });

  /**
   * @param config - Workspace-level config (currently empty for Notion)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: NotionConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Notion config', 'INVALID_CONFIG', false));
    }

    if (!this.tokens) {
      return err(
        new ConnectorError(
          'No OAuth tokens available. Complete OAuth flow before calling connect().',
          'AUTH_MISSING',
          false,
        ),
      );
    }

    this.log.info('Connected to Notion');
    return ok(undefined);
  }

  /** Inject tokens directly (used in tests and OAuth callback handlers). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * @param options - Sync options including lastSyncedAt and entityTypes filter
   * @returns AsyncGenerator yielding SemanticEntity objects
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const types = options.entityTypes ?? ['page', 'database_row'];
    yield* this.searchPages(options, types);
  }

  private async *searchPages(
    options: SyncOptions,
    types: string[],
  ): AsyncGenerator<SemanticEntity> {
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const body: Record<string, unknown> = {
        filter: { value: 'page', property: 'object' },
        page_size: 100,
      };
      if (cursor) body['start_cursor'] = cursor;
      if (options.lastSyncedAt) {
        body['filter'] = {
          and: [
            { value: 'page', property: 'object' },
            { timestamp: 'last_edited_time', last_edited_time: { on_or_after: options.lastSyncedAt.toISOString() } },
          ],
        };
      }

      const data = await this.post<NotionSearchResponse>('/search', body);
      pageCount++;
      this.log.debug('Synced Notion page batch', { page: pageCount, count: data.results.length });

      for (const page of data.results) {
        const entity = transformPage(page);
        if (types.includes(entity.type)) {
          yield entity;
        }
      }

      cursor = data.next_cursor ?? undefined;
    } while (cursor);
  }

  /**
   * @returns ConnectorSchema describing page and database_row entity types
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'page',
          attributes: [
            { name: 'Status', type: 'string', nullable: true },
            { name: 'Tags', type: 'string[]', nullable: true },
            { name: 'Assignee', type: 'string', nullable: true },
          ],
        },
        {
          name: 'database_row',
          attributes: [
            { name: 'Status', type: 'string', nullable: true },
            { name: 'Priority', type: 'string', nullable: true },
            { name: 'Due Date', type: 'date', nullable: true },
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
      await this.get('/users/me');
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
    return this.request<T>('GET', path, undefined);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    if (!this.tokens) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${NOTION_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError('Notion auth failed — token may be expired', 'AUTH_EXPIRED', true);
      }
      if (response.status === 429) {
        throw new ConnectorError('Notion rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new ConnectorError(
          `Notion API error: ${response.status} ${response.statusText}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
