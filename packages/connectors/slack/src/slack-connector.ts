import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformChannel, transformUser, transformMessage } from './transformers.js';
import type { SlackChannel, SlackUser, SlackMessage } from './transformers.js';

export { manifest };

const configSchema = z.object({
  channelIds: z.array(z.string().min(1)).optional(),
  includeMessages: z.boolean().optional().default(true),
  messageLookbackDays: z.number().int().positive().max(365).optional().default(30),
});

export type SlackConfig = z.infer<typeof configSchema>;

const SLACK_API_BASE = 'https://slack.com/api';
const REQUEST_TIMEOUT_MS = 10_000;

interface SlackListResponse<T> {
  ok: boolean;
  error?: string;
  channels?: T[];
  members?: T[];
  messages?: T[];
  response_metadata?: { next_cursor?: string };
}

export class SlackConnector extends BaseConnector<SlackConfig> {
  private accessToken: string | null = null;
  private readonly log = logger.child({ connector: 'slack' });

  /**
   * @param config - Workspace-level config
   * @returns Result<void, ConnectorError>
   */
  async connect(config: SlackConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Slack config', 'INVALID_CONFIG', false));
    }

    if (!this.accessToken) {
      return err(new ConnectorError(
        'No OAuth access token. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    this.log.info('Connected to Slack');
    return ok(undefined);
  }

  /** Inject access token (used in tests and OAuth callback handlers). */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * @param options - Sync options including lastSyncedAt cursor and entityTypes filter
   * @returns AsyncGenerator yielding SemanticEntity objects
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const types = options.entityTypes ?? ['channel', 'user', 'message'];
    const config = configSchema.parse((options as { config?: SlackConfig }).config ?? {});

    if (types.includes('channel') || types.includes('message')) {
      const channels = await this.listAllChannels(config.channelIds);

      if (types.includes('channel')) {
        for (const channel of channels) {
          yield transformChannel(channel);
        }
      }

      if (types.includes('message') && config.includeMessages) {
        const oldest = options.lastSyncedAt
          ? String(options.lastSyncedAt.getTime() / 1000)
          : String(Date.now() / 1000 - config.messageLookbackDays * 86400);

        for (const channel of channels) {
          yield* this.syncChannelMessages(channel.id, oldest);
        }
      }
    }

    if (types.includes('user')) {
      yield* this.syncUsers();
    }
  }

  private async *syncUsers(): AsyncGenerator<SemanticEntity> {
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: '200' });
      if (cursor) params.set('cursor', cursor);

      const data = await this.call<SlackListResponse<SlackUser>>(`users.list?${params}`);

      for (const user of data.members ?? []) {
        if (user.deleted || user.is_bot) continue;
        yield transformUser(user);
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }

  private async *syncChannelMessages(
    channelId: string,
    oldest: string,
  ): AsyncGenerator<SemanticEntity> {
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ channel: channelId, limit: '200', oldest });
      if (cursor) params.set('cursor', cursor);

      const data = await this.call<SlackListResponse<SlackMessage>>(`conversations.history?${params}`);

      for (const message of data.messages ?? []) {
        if (message.type !== 'message' || !message.text) continue;
        yield transformMessage(message, channelId);
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }

  /**
   * @returns ConnectorSchema describing all entity types
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'channel',
          attributes: [
            { name: 'topic', type: 'string', nullable: true },
            { name: 'purpose', type: 'string', nullable: true },
            { name: 'memberCount', type: 'number', nullable: true },
            { name: 'isPrivate', type: 'boolean', nullable: false },
          ],
        },
        {
          name: 'user',
          attributes: [
            { name: 'username', type: 'string', nullable: false },
            { name: 'displayName', type: 'string', nullable: true },
            { name: 'title', type: 'string', nullable: true },
            { name: 'isBot', type: 'boolean', nullable: false },
          ],
        },
        {
          name: 'message',
          attributes: [
            { name: 'text', type: 'string', nullable: false },
            { name: 'channelId', type: 'string', nullable: false },
            { name: 'userId', type: 'string', nullable: true },
          ],
        },
      ],
      version: manifest.id + '@1.0.0',
    };
  }

  /**
   * @returns HealthStatus — calls auth.test to verify connectivity
   */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const data = await this.call<{ ok: boolean; error?: string }>('auth.test');
      if (!data.ok) {
        return { healthy: false, latencyMs: Date.now() - start, error: data.error ?? 'Unknown Slack error', checkedAt: new Date() };
      }
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

  private async listAllChannels(filterIds?: string[]): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: '200', exclude_archived: 'true' });
      if (cursor) params.set('cursor', cursor);

      const data = await this.call<SlackListResponse<SlackChannel>>(`conversations.list?${params}`);

      for (const channel of data.channels ?? []) {
        if (!filterIds || filterIds.includes(channel.id)) {
          channels.push(channel);
        }
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels;
  }

  private async call<T>(endpoint: string): Promise<T> {
    if (!this.accessToken) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new ConnectorError('Slack rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new ConnectorError(
          `Slack API HTTP error: ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const data = await response.json() as { ok: boolean; error?: string } & T;

      if (!data.ok) {
        const code = data.error ?? 'unknown_error';
        const retryable = ['ratelimited', 'service_unavailable'].includes(code);
        if (code === 'invalid_auth' || code === 'token_revoked' || code === 'not_authed') {
          throw new ConnectorError(`Slack auth error: ${code}`, 'AUTH_EXPIRED', false);
        }
        throw new ConnectorError(`Slack API error: ${code}`, 'API_ERROR', retryable);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
