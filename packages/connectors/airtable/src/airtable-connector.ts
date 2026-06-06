import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';
import { transformBase, transformRecord } from './transformers.js';
import type { AirtableBase, AirtableTable, AirtableRecord } from './transformers.js';

export { manifest };

const configSchema = z.object({
  baseIds: z.array(z.string().min(1)).optional(),
});

export type AirtableConfig = z.infer<typeof configSchema>;

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const REQUEST_TIMEOUT_MS = 10_000;

interface ListBasesResponse {
  bases: AirtableBase[];
  offset?: string;
}

interface ListTablesResponse {
  tables: AirtableTable[];
}

interface ListRecordsResponse {
  records: AirtableRecord[];
  offset?: string;
}

export class AirtableConnector extends BaseConnector<AirtableConfig> {
  private accessToken: string | null = null;
  private readonly log = logger.child({ connector: 'airtable' });

  /**
   * @param config - Workspace-level config (optional baseIds filter)
   * @returns Result<void, ConnectorError>
   */
  async connect(config: AirtableConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError('Invalid Airtable config', 'INVALID_CONFIG', false));
    }

    if (!this.accessToken) {
      return err(new ConnectorError(
        'No OAuth access token. Complete OAuth flow before calling connect().',
        'AUTH_MISSING',
        false,
      ));
    }

    this.log.info('Connected to Airtable');
    return ok(undefined);
  }

  /** Inject access token (used in tests and OAuth callback handlers). */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * @param options - Sync options including lastSyncedAt cursor and entityTypes filter
   * @returns AsyncGenerator yielding SemanticEntity objects (bases and records)
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    const types = options.entityTypes ?? ['base', 'record'];
    const config = (options as { config?: AirtableConfig }).config ?? {};
    const filterBaseIds = config.baseIds ?? [];

    // Fetch all accessible bases
    const bases = await this.listAllBases();
    const targetBases = filterBaseIds.length > 0
      ? bases.filter((b) => filterBaseIds.includes(b.id))
      : bases;

    if (types.includes('base')) {
      for (const base of targetBases) {
        yield transformBase(base);
      }
    }

    if (types.includes('record')) {
      for (const base of targetBases) {
        yield* this.syncBaseRecords(base.id, options);
      }
    }
  }

  private async *syncBaseRecords(
    baseId: string,
    options: SyncOptions,
  ): AsyncGenerator<SemanticEntity> {
    const tablesResponse = await this.get<ListTablesResponse>(`/meta/bases/${baseId}/tables`);

    for (const table of tablesResponse.tables) {
      yield* this.syncTableRecords(baseId, table, options);
    }
  }

  private async *syncTableRecords(
    baseId: string,
    table: AirtableTable,
    options: SyncOptions,
  ): AsyncGenerator<SemanticEntity> {
    let offset: string | undefined;

    do {
      const params = new URLSearchParams({ pageSize: '100' });
      if (offset) params.set('offset', offset);

      // Incremental sync: filter by modifiedTime
      if (options.lastSyncedAt) {
        const iso = options.lastSyncedAt.toISOString();
        params.set('filterByFormula', `IS_AFTER(LAST_MODIFIED_TIME(), '${iso}')`);
      }

      const data = await this.get<ListRecordsResponse>(
        `/${baseId}/${encodeURIComponent(table.id)}?${params}`,
      );

      this.log.debug('Synced Airtable records', {
        baseId,
        tableId: table.id,
        count: data.records.length,
      });

      for (const record of data.records) {
        yield transformRecord(record, baseId, table.id, table.name, table.fields);
      }

      offset = data.offset;
    } while (offset);
  }

  /**
   * @returns ConnectorSchema describing all entity types
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: [
        {
          name: 'base',
          attributes: [
            { name: 'permissionLevel', type: 'string', nullable: false },
          ],
        },
        {
          name: 'record',
          attributes: [
            { name: 'tableName', type: 'string', nullable: false },
            { name: 'baseId', type: 'string', nullable: false },
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
      await this.get('/meta/bases?pageSize=1');
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

  private async listAllBases(): Promise<AirtableBase[]> {
    const bases: AirtableBase[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams();
      if (offset) params.set('offset', offset);

      const data = await this.get<ListBasesResponse>(
        `/meta/bases${params.size > 0 ? `?${params}` : ''}`,
      );
      bases.push(...data.bases);
      offset = data.offset;
    } while (offset);

    return bases;
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.accessToken) {
      throw new ConnectorError('Not authenticated', 'AUTH_MISSING', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${AIRTABLE_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError('Airtable auth failed — token may be expired', 'AUTH_EXPIRED', true);
      }
      if (response.status === 429) {
        throw new ConnectorError('Airtable rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        throw new ConnectorError(
          `Airtable API error: ${response.status} ${response.statusText}`,
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
