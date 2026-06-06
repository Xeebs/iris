import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformIssue, transformProject, transformCycle } from './transformers.js';
import type { LinearIssue, LinearProject, LinearCycle } from './transformers.js';

export { manifest };

const configSchema = z.object({});
export type LinearConfig = z.infer<typeof configSchema>;

interface OAuthTokens {
  accessToken: string;
  expiresAt?: Date;
}

const LINEAR_API = 'https://api.linear.app/graphql';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;

export class LinearConnector extends BaseConnector<LinearConfig> {
  private tokens: OAuthTokens | null = null;
  private readonly log = logger.child({ connector: 'linear' });

  /**
   * @param config - Workspace-level config (no additional config required beyond OAuth)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: LinearConfig): Promise<Result<void, ConnectorError>> {
    configSchema.parse(config);

    if (!this.tokens) {
      return err(new ConnectorError(
        'No OAuth tokens available. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    this.log.info('Linear connector connected');
    return ok(undefined);
  }

  /** Provide OAuth tokens externally (called by OAuth callback handler). */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
  }

  /**
   * Sync issues, projects, and cycles as SemanticEntity objects.
   * Uses updatedAt cursor for incremental sync on issues.
   *
   * @param options - SyncOptions with optional lastSyncedAt cursor
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.tokens) {
      throw new ConnectorError('Connector not connected. Call connect() first.', 'NOT_CONNECTED', false);
    }

    const updatedAfter = options.lastSyncedAt
      ? new Date(options.lastSyncedAt).toISOString()
      : null;

    yield* this.syncProjects();
    yield* this.syncCycles();
    yield* this.syncIssues(updatedAfter);
  }

  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'issue',
          attributes: [
            { name: 'status', type: 'string', nullable: false },
            { name: 'stateType', type: 'string', nullable: false },
            { name: 'priority', type: 'string', nullable: true },
            { name: 'assignee', type: 'string', nullable: true },
            { name: 'labels', type: 'string', nullable: true },
            { name: 'team', type: 'string', nullable: false },
          ],
        },
        {
          name: 'project',
          attributes: [
            { name: 'description', type: 'string', nullable: true },
            { name: 'state', type: 'string', nullable: false },
          ],
        },
        {
          name: 'cycle',
          attributes: [
            { name: 'number', type: 'number', nullable: false },
            { name: 'team', type: 'string', nullable: false },
            { name: 'startsAt', type: 'string', nullable: false },
            { name: 'endsAt', type: 'string', nullable: false },
          ],
        },
      ],
      version: `${manifest.id}@1.0.0`,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.tokens) {
      return { healthy: false, error: 'Not connected', checkedAt: new Date() };
    }

    const start = Date.now();
    try {
      const result = await this.graphql<{ viewer: { id: string } }>('{ viewer { id } }');
      if (result.data?.viewer?.id) {
        return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
      }
      return { healthy: false, error: 'Viewer query returned no data', latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (e) {
      return {
        healthy: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      };
    }
  }

  private async *syncIssues(updatedAfter: string | null): AsyncGenerator<SemanticEntity> {
    const filterClause = updatedAfter
      ? `, filter: { updatedAt: { gte: "${updatedAfter}" } }`
      : '';

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const query = `{
        issues(first: ${PAGE_SIZE}${afterClause}${filterClause}, orderBy: updatedAt) {
          nodes {
            id title identifier priority priorityLabel
            updatedAt createdAt cycleId
            state { id name type }
            team { id name key }
            assignee { id name }
            labels { nodes { id name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;

      const result = await this.graphql<{
        issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
      }>(query);

      if (!result.data?.issues) {
        throw new ConnectorError('Linear issues query returned no data', 'API_ERROR', false);
      }

      for (const issue of result.data.issues.nodes) {
        yield transformIssue(issue);
      }

      hasNextPage = result.data.issues.pageInfo.hasNextPage;
      cursor = result.data.issues.pageInfo.endCursor;
    }

    this.log.info('Issue sync complete');
  }

  private async *syncProjects(): AsyncGenerator<SemanticEntity> {
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const query = `{
        projects(first: ${PAGE_SIZE}${afterClause}) {
          nodes {
            id name description state updatedAt
            teams { nodes { id name key } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;

      const result = await this.graphql<{
        projects: { nodes: LinearProject[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
      }>(query);

      if (!result.data?.projects) {
        throw new ConnectorError('Linear projects query returned no data', 'API_ERROR', false);
      }

      for (const project of result.data.projects.nodes) {
        yield transformProject(project);
      }

      hasNextPage = result.data.projects.pageInfo.hasNextPage;
      cursor = result.data.projects.pageInfo.endCursor;
    }

    this.log.info('Project sync complete');
  }

  private async *syncCycles(): AsyncGenerator<SemanticEntity> {
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const query = `{
        cycles(first: ${PAGE_SIZE}${afterClause}) {
          nodes {
            id name number startsAt endsAt updatedAt
            team { id name key }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`;

      const result = await this.graphql<{
        cycles: { nodes: LinearCycle[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
      }>(query);

      if (!result.data?.cycles) {
        throw new ConnectorError('Linear cycles query returned no data', 'API_ERROR', false);
      }

      for (const cycle of result.data.cycles.nodes) {
        yield transformCycle(cycle);
      }

      hasNextPage = result.data.cycles.pageInfo.hasNextPage;
      cursor = result.data.cycles.pageInfo.endCursor;
    }

    this.log.info('Cycle sync complete');
  }

  private async graphql<T>(query: string): Promise<{ data: T; errors?: unknown[] }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(LINEAR_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError('Linear authentication failed: invalid or expired token', 'AUTH_EXPIRED', false);
      }

      if (!response.ok) {
        throw new ConnectorError(
          `Linear API error: HTTP ${response.status}`,
          'API_ERROR',
          response.status >= 500,
        );
      }

      const body = await response.json() as { data: T; errors?: unknown[] };
      if (body.errors?.length) {
        throw new ConnectorError(
          `Linear GraphQL error: ${JSON.stringify(body.errors)}`,
          'API_ERROR',
          false,
        );
      }

      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
}
