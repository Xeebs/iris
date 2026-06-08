import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import {
  transformRepository,
  transformIssue,
  transformPullRequest,
  transformDiscussion,
} from './transformers.js';
import type {
  GitHubRepository,
  GitHubIssue,
  GitHubPullRequest,
  GitHubDiscussion,
} from './transformers.js';

export { manifest };

const configSchema = z.object({ owner: z.string().min(1) });
export type GitHubConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  expiresAt: Date | null;
}

interface RateLimitResponse {
  resources: { core: { limit: number; remaining: number; reset: number } };
}

const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;

export class GitHubConnector extends BaseConnector<GitHubConfig> {
  private tokens: OAuthTokens | null = null;
  private config: GitHubConfig | null = null;
  private readonly log = logger.child({ connector: 'github' });

  /**
   * @param config - Workspace-level config with owner (GitHub user or org login)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: GitHubConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid GitHub config: owner is required', 'INVALID_CONFIG', false));
    }

    if (!this.tokens) {
      return err(new ConnectorError(
        'No OAuth tokens available. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    this.config = parsed.data;
    this.log.info('Connected to GitHub', { owner: parsed.data.owner });
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
    if (!this.config) {
      throw new ConnectorError('Connector not initialized — call connect() first', 'NOT_CONNECTED', false);
    }

    const types = options.entityTypes ?? ['repository', 'issue', 'pull_request', 'discussion'];
    const owner = this.config.owner;

    const repos = await this.listRepositories(owner);

    if (types.includes('repository')) {
      for (const repo of repos) {
        yield transformRepository(repo);
      }
    }

    for (const repo of repos) {
      if (types.includes('issue')) {
        yield* this.syncIssues(owner, repo.name, options);
      }
      if (types.includes('pull_request')) {
        yield* this.syncPullRequests(owner, repo.name, options);
      }
      if (types.includes('discussion')) {
        yield* this.syncDiscussions(owner, repo.name);
      }
    }
  }

  private async listRepositories(owner: string): Promise<GitHubRepository[]> {
    const repos: GitHubRepository[] = [];
    let page = 1;

    while (true) {
      const data = await this.get<GitHubRepository[]>(
        `/users/${owner}/repos?per_page=${PAGE_SIZE}&page=${page}&sort=updated`,
      );
      repos.push(...data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    return repos;
  }

  private async *syncIssues(owner: string, repo: string, options: SyncOptions): AsyncGenerator<SemanticEntity> {
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        state: 'all',
        per_page: String(PAGE_SIZE),
        page: String(page),
        sort: 'updated',
      });

      if (options.lastSyncedAt) {
        params.set('since', options.lastSyncedAt.toISOString());
      }

      const data = await this.get<GitHubIssue[]>(`/repos/${owner}/${repo}/issues?${params}`);
      this.log.debug('Synced issue page', { repo, page, count: data.length });

      for (const issue of data) {
        if (!issue.pull_request) {
          yield transformIssue(issue, owner, repo);
        }
      }

      if (data.length < PAGE_SIZE) break;
      page++;
    }
  }

  private async *syncPullRequests(owner: string, repo: string, options: SyncOptions): AsyncGenerator<SemanticEntity> {
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        state: 'all',
        per_page: String(PAGE_SIZE),
        page: String(page),
        sort: 'updated',
        direction: 'desc',
      });

      const data = await this.get<GitHubPullRequest[]>(`/repos/${owner}/${repo}/pulls?${params}`);
      this.log.debug('Synced PR page', { repo, page, count: data.length });

      for (const pr of data) {
        if (!options.lastSyncedAt || new Date(pr.updated_at) >= options.lastSyncedAt) {
          yield transformPullRequest(pr, owner, repo);
        }
      }

      if (data.length < PAGE_SIZE) break;
      page++;
    }
  }

  private async *syncDiscussions(owner: string, repo: string): AsyncGenerator<SemanticEntity> {
    let page = 1;

    while (true) {
      const data = await this.get<GitHubDiscussion[]>(
        `/repos/${owner}/${repo}/discussions?per_page=${PAGE_SIZE}&page=${page}`,
      );
      this.log.debug('Synced discussion page', { repo, page, count: data.length });

      for (const discussion of data) {
        yield transformDiscussion(discussion, owner, repo);
      }

      if (data.length < PAGE_SIZE) break;
      page++;
    }
  }

  /**
   * @returns ConnectorSchema describing all entity types and their attributes
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'repository',
          attributes: [
            { name: 'description', type: 'string', nullable: true },
            { name: 'language', type: 'string', nullable: true },
            { name: 'stars', type: 'number', nullable: false },
            { name: 'forks', type: 'number', nullable: false },
            { name: 'openIssuesCount', type: 'number', nullable: false },
            { name: 'isPrivate', type: 'boolean', nullable: false },
            { name: 'defaultBranch', type: 'string', nullable: false },
            { name: 'topics', type: 'string', nullable: true },
          ],
        },
        {
          name: 'issue',
          attributes: [
            { name: 'state', type: 'string', nullable: false },
            { name: 'number', type: 'number', nullable: false },
            { name: 'author', type: 'string', nullable: false },
            { name: 'labels', type: 'string', nullable: true },
            { name: 'milestone', type: 'string', nullable: true },
            { name: 'commentCount', type: 'number', nullable: false },
          ],
        },
        {
          name: 'pull_request',
          attributes: [
            { name: 'state', type: 'string', nullable: false },
            { name: 'number', type: 'number', nullable: false },
            { name: 'author', type: 'string', nullable: false },
            { name: 'headBranch', type: 'string', nullable: false },
            { name: 'baseBranch', type: 'string', nullable: false },
            { name: 'draft', type: 'boolean', nullable: false },
            { name: 'merged', type: 'boolean', nullable: false },
            { name: 'reviewers', type: 'string', nullable: true },
          ],
        },
        {
          name: 'discussion',
          attributes: [
            { name: 'category', type: 'string', nullable: false },
            { name: 'author', type: 'string', nullable: false },
            { name: 'answered', type: 'boolean', nullable: false },
            { name: 'commentCount', type: 'number', nullable: false },
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
      await this.get<RateLimitResponse>('/rate_limit');
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
    if (!this.tokens) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${GITHUB_API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError(
          'GitHub auth failed — token may be expired or revoked',
          'AUTH_EXPIRED',
          true,
        );
      }
      if (response.status === 403) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          throw new ConnectorError('GitHub rate limit exceeded', 'RATE_LIMITED', true);
        }
        throw new ConnectorError('GitHub access forbidden', 'FORBIDDEN', false);
      }
      if (response.status === 429) {
        throw new ConnectorError('GitHub rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new ConnectorError(
          `GitHub API error: ${response.status} ${response.statusText}`,
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
