import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseConnector, ConnectorError } from '@iris/connector-sdk';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus, AttributeValue } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

import { manifest } from './manifest.js';

export { manifest };

const tableConfigSchema = z.object({
  name: z.string().min(1),
  entityType: z.string().min(1).default('row'),
  updatedAtColumn: z.string().optional(),
  labelColumn: z.string().optional(),
});

const configSchema = z.object({
  account: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  warehouse: z.string().min(1),
  database: z.string().min(1),
  schema: z.string().min(1).default('PUBLIC'),
  tables: z.array(tableConfigSchema).min(1),
});

export type TableConfig = z.infer<typeof tableConfigSchema>;
export type SnowflakeConfig = z.infer<typeof configSchema>;

interface SnowflakeStatementResponse {
  statementHandle: string;
  resultSetMetaData: {
    rowType: Array<{ name: string; type: string }>;
    numRows: number;
    partitionInfo: Array<{ rowCount: number }>;
  };
  data: string[][];
}

interface SnowflakePartitionResponse {
  data: string[][];
}

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;

export class SnowflakeConnector extends BaseConnector<SnowflakeConfig> {
  private config: SnowflakeConfig | null = null;
  private baseUrl = '';
  private readonly log = logger.child({ connector: 'snowflake' });

  /**
   * @param config - Snowflake account credentials and table list
   * @returns Result<void, ConnectorError>
   */
  async connect(config: SnowflakeConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError(
        `Invalid Snowflake config: ${parsed.error.message}`,
        'INVALID_CONFIG',
        false,
      ));
    }

    this.config = parsed.data;
    this.baseUrl = `https://${parsed.data.account}.snowflakecomputing.com`;

    try {
      await this.executeStatement('SELECT CURRENT_VERSION()');
      this.log.info('Connected to Snowflake', {
        account: parsed.data.account,
        database: parsed.data.database,
        tables: parsed.data.tables.map((t) => t.name),
      });
      return ok(undefined);
    } catch (e) {
      this.config = null;
      return err(new ConnectorError(`Snowflake connection failed: ${String(e)}`, 'CONNECTION_FAILED', true));
    }
  }

  /**
   * @param options - Sync options including lastSyncedAt for incremental sync
   * @returns AsyncGenerator yielding SemanticEntity objects
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.config) {
      throw new ConnectorError('Not connected — call connect() first', 'NOT_CONNECTED', false);
    }

    const tableFilter = options.entityTypes?.length
      ? this.config.tables.filter((t) => options.entityTypes!.includes(t.entityType))
      : this.config.tables;

    for (const tableConf of tableFilter) {
      yield* this.syncTable(tableConf, options);
    }
  }

  /**
   * @returns ConnectorSchema derived from the configured tables
   */
  async getSchema(): Promise<ConnectorSchema> {
    return {
      entityTypes: (this.config?.tables ?? []).map((t) => ({
        name: t.entityType,
        attributes: [
          { name: 'table', type: 'string', nullable: false },
          { name: 'updatedAt', type: 'date', nullable: true },
        ],
      })),
      version: manifest.id + '@1.0.0',
    };
  }

  /**
   * @returns HealthStatus by running a lightweight query
   */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.executeStatement('SELECT 1');
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

  private async *syncTable(tableConf: TableConfig, options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.config) return;

    const fqTable = `${this.config.database}.${this.config.schema}.${tableConf.name}`;
    const whereClauses: string[] = [];

    if (options.lastSyncedAt && tableConf.updatedAtColumn) {
      const iso = options.lastSyncedAt.toISOString();
      whereClauses.push(`${tableConf.updatedAtColumn} >= '${iso}'`);
    }

    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM ${fqTable} ${where} LIMIT ${PAGE_SIZE}`;

    const response = await this.executeStatement(sql);
    const columns = response.resultSetMetaData.rowType.map((c) => c.name.toLowerCase());

    this.log.debug('Synced Snowflake table', {
      table: tableConf.name,
      rowCount: response.data.length,
    });

    let rowIndex = 0;
    for (const row of response.data) {
      yield this.rowToEntity(tableConf, columns, row, rowIndex++);
    }

    for (let partIdx = 1; partIdx < (response.resultSetMetaData.partitionInfo?.length ?? 1); partIdx++) {
      const partition = await this.fetchPartition(response.statementHandle, partIdx);
      for (const row of partition.data) {
        yield this.rowToEntity(tableConf, columns, row, rowIndex++);
      }
    }
  }

  private rowToEntity(
    tableConf: TableConfig,
    columns: string[],
    row: string[],
    rowIndex: number,
  ): SemanticEntity {
    const attributes: Record<string, AttributeValue> = {
      table: tableConf.name,
    };

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const val = row[i];
      if (col && val !== undefined) {
        attributes[col] = val === '' ? null : val;
      }
    }

    const labelCol = tableConf.labelColumn?.toLowerCase();
    const labelVal = labelCol ? (attributes[labelCol] ?? null) : null;
    const label = typeof labelVal === 'string' && labelVal
      ? labelVal
      : `${tableConf.name} row ${rowIndex}`;

    const updatedAtCol = tableConf.updatedAtColumn?.toLowerCase();
    const updatedAtVal = updatedAtCol ? attributes[updatedAtCol] : null;
    const lastModified = typeof updatedAtVal === 'string' && updatedAtVal
      ? new Date(updatedAtVal)
      : new Date(0);

    const rowId = `snowflake:${tableConf.name}:${rowIndex}`;

    return {
      id: rowId,
      type: tableConf.entityType,
      label,
      attributes,
      relationships: [],
      lastModified,
      sourceId: rowId,
    };
  }

  private async executeStatement(sql: string): Promise<SnowflakeStatementResponse> {
    if (!this.config) throw new ConnectorError('Not connected', 'NOT_CONNECTED', false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      const response = await fetch(`${this.baseUrl}/api/v2/statements`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'BASIC',
        },
        body: JSON.stringify({
          statement: sql,
          warehouse: this.config.warehouse,
          database: this.config.database,
          schema: this.config.schema,
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ConnectorError('Snowflake auth failed — check username and password', 'AUTH_FAILED', false);
      }
      if (response.status === 429) {
        throw new ConnectorError('Snowflake rate limit exceeded', 'RATE_LIMITED', true);
      }
      if (!response.ok) {
        const body = await response.text();
        throw new ConnectorError(`Snowflake API error ${response.status}: ${body}`, 'API_ERROR', response.status >= 500);
      }

      return response.json() as Promise<SnowflakeStatementResponse>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchPartition(statementHandle: string, partition: number): Promise<SnowflakePartitionResponse> {
    if (!this.config) throw new ConnectorError('Not connected', 'NOT_CONNECTED', false);

    const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const response = await fetch(
      `${this.baseUrl}/api/v2/statements/${statementHandle}?partition=${partition}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'X-Snowflake-Authorization-Token-Type': 'BASIC',
        },
      },
    );

    if (!response.ok) {
      throw new ConnectorError(`Failed to fetch Snowflake partition ${partition}`, 'API_ERROR', true);
    }

    return response.json() as Promise<SnowflakePartitionResponse>;
  }
}
