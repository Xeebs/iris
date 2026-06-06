import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformProject, transformIssue } from './transformers.js';
import type { JiraProject, JiraIssue } from './transformers.js';

export { manifest };

const configSchema = z.object({ cloudId: z.string().min(1) });
export type JiraConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const JIRA_API_BASE = 'https://api.atlassian.com';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;

export class JiraConnector extends BaseConnector<JiraConfig> {
  private tokens: OAuthTokens | null = null;
  private cloudId: string | null = null;
  private readonly log = logger.child({ connector: 'jira' });

  /**
   * @param config - Workspace-level config with cloudId
   * @returns Result<void, ConnectorError>
   */
  async connect(config: JiraConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Jira config: cloudId is required', 'INVALID_CONFIG', false));
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
    this.log.info('Jira connector connected', { cloudId: this.cloudId });
    return ok(undefined);
  }

  /** Provide OAuth tokens externally (called by OAuth callback handler). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * Sync projects and issues as SemanticEntity objects.
   * Incremental sync: only yields entities updated after lastSyncedAt.
   *
   * @param options - SyncOptions with optional lastSyncedAt cursor
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.tokens || !this.cloudId) {
      throw new ConnectorError('Connector not connected. Call connect() first.', 'NOT_CONNECTED', false);
    }

    const updatedAfter = options.lastSyncedAt
      ? new Date(options.lastSyncedAt).toISOString()
      : null;

    // Sync projects first (no incremental cursor — project list is typically small)
    yield* this.syncProjects();

    // Sync issues with JQL incremental cursor
    yield* this.syncIssues(updatedAfter);
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'project',
          attributes: [
            { name: 'key', type: 'string', nullable: false },
            { name: 'projectType', type: 'string', nullable: false },
            { name: 'description', type: 'string', nullable: true },
            { name: 'lead', type: 'string', nullable: true },
          ],
        },
        {
          name: 'issue',
          attributes: [
            { name: 'key', type: 'string', nullable: false },
            { name: 'issueType', type: 'string', nullable: false },
            { name: 'status', type: 'string', nullable: false },
            { name: 'statusCategory', type: 'string', nullable: true },
            { name: 'priority', type: 'string', nullable: true },
            { name: 'assignee', type: 'string', nullable: true },
            { name: 'reporter', type: 'string', nullable: true },
            { name: 'labels', type: 'string', nullable: true },
            { name: 'project', type: 'string', nullable: false },
            { name: 'resolved', type: 'string', nullable: true },
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
        `${JIRA_API_BASE}/ex/jira/${this.cloudId}/rest/api/3/myself`,
      );
      if (response.ok) {
        return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
      }
      return { healthy: false, error: `Health check failed: HTTP ${response.status}`, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (e) {
      return { healthy: false, error: e instanceof Error ? e.message : 'Unknown error', latencyMs: Date.now() - start, checkedAt: new Date() };
    }
  }

  private async *syncProjects(): AsyncGenerator<SemanticEntity> {
    let startAt = 0;
    let isLast = false;

    while (!isLast) {
      const url = `${JIRA_API_BASE}/ex/jira/${this.cloudId}/rest/api/3/project/search?startAt=${startAt}&maxResults=${PAGE_SIZE}&expand=lead,description`;
      const response = await this.fetchWithAuth(url);

      if (!response.ok) {
        throw new ConnectorError(
          `Jira project list failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as { values: JiraProject[]; isLast: boolean };
      for (const project of body.values) {
        yield transformProject(project);
      }

      isLast = body.isLast;
      startAt += PAGE_SIZE;
    }

    this.log.info('Project sync complete', { startAt });
  }

  private async *syncIssues(updatedAfter: string | null): AsyncGenerator<SemanticEntity> {
    const jql = updatedAfter
      ? `updated >= "${updatedAfter.slice(0, 10)}" ORDER BY updated ASC`
      : 'ORDER BY updated ASC';

    let startAt = 0;
    let total = Infinity;

    while (startAt < total) {
      const url = new URL(`${JIRA_API_BASE}/ex/jira/${this.cloudId}/rest/api/3/search`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('startAt', String(startAt));
      url.searchParams.set('maxResults', String(PAGE_SIZE));
      url.searchParams.set('fields', 'summary,description,issuetype,status,priority,assignee,reporter,labels,project,created,updated,resolutiondate,customfield_10014');

      const response = await this.fetchWithAuth(url.toString());

      if (!response.ok) {
        throw new ConnectorError(
          `Jira issue search failed: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as { issues: JiraIssue[]; total: number; startAt: number };
      total = body.total;

      for (const issue of body.issues) {
        yield transformIssue(issue);
      }

      startAt += body.issues.length;
      if (body.issues.length === 0) break;
    }

    this.log.info('Issue sync complete', { total });
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

      // Refresh and retry once on 401
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
          client_id: process.env['JIRA_CLIENT_ID'],
          client_secret: process.env['JIRA_CLIENT_SECRET'],
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

      this.log.info('Jira tokens refreshed');
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
