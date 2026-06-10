import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import pg from 'postgres';

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
  connectionString: z.string().min(1),
  tables: z.array(tableConfigSchema).min(1),
});

export type TableConfig = z.infer<typeof tableConfigSchema>;
export type PostgresConfig = z.infer<typeof configSchema>;

const BATCH_SIZE = 500;

/** A foreign key from one table column to a referenced table/column. */
type FkEntry = {
  column: string;
  refTable: string;
  refColumn: string;
};

export class PostgresConnector extends BaseConnector<PostgresConfig> {
  private sql: ReturnType<typeof pg> | null = null;
  private config: PostgresConfig | null = null;
  /** FK map: table name → list of FK entries discovered at connect time */
  private fkMap: Map<string, FkEntry[]> = new Map();
  /** Table name → entityType (from config) for resolving FK target entity types */
  private tableEntityTypes: Map<string, string> = new Map();
  private readonly log = logger.child({ connector: 'postgres' });

  /**
   * @param config - Connection string and table list
   * @returns Result<void, ConnectorError>
   */
  async connect(config: PostgresConfig): Promise<Result<void, ConnectorError>> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      return err(new ConnectorError(
        `Invalid Postgres config: ${parsed.error.message}`,
        'INVALID_CONFIG',
        false,
      ));
    }

    try {
      this.sql = pg(parsed.data.connectionString, { ssl: false, max: 5 });
      this.config = parsed.data;
      await this.sql`SELECT 1`;

      // Build table → entityType lookup from config
      this.tableEntityTypes = new Map(parsed.data.tables.map((t) => [t.name, t.entityType]));

      // Discover FK relationships for all configured tables
      this.fkMap = await this.discoverForeignKeys(parsed.data.tables.map((t) => t.name));

      this.log.info('Connected to Postgres', {
        tables: parsed.data.tables.map((t) => t.name),
        fkRelationships: this.fkMap.size,
      });
      return ok(undefined);
    } catch (e) {
      this.sql = null;
      return err(new ConnectorError(`Postgres connection failed: ${String(e)}`, 'CONNECTION_FAILED', true));
    }
  }

  /**
   * @param options - Sync options including lastSyncedAt for incremental sync
   */
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> {
    if (!this.sql || !this.config) {
      throw new ConnectorError('Not connected — call connect() first', 'NOT_CONNECTED', false);
    }

    const tableFilter = options.entityTypes?.length
      ? this.config.tables.filter((t) => options.entityTypes!.includes(t.entityType))
      : this.config.tables;

    for (const tableConf of tableFilter) {
      yield* this.syncTable(tableConf, options);
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    if (!this.sql || !this.config) {
      throw new ConnectorError('Not connected', 'NOT_CONNECTED', false);
    }

    const entityTypes = await Promise.all(
      this.config.tables.map(async (tableConf) => {
        const columns = await this.sql!<Array<{ column_name: string; data_type: string }>>`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = ${tableConf.name}
            AND table_schema = 'public'
          ORDER BY ordinal_position
        `;

        return {
          name: tableConf.entityType,
          attributes: columns.map((c: { column_name: string; data_type: string }) => ({
            name: c.column_name,
            type: pgTypeToAttributeType(c.data_type),
            nullable: true,
          })),
        };
      }),
    );

    return { entityTypes, version: '1.0.0' };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.sql) {
      return { healthy: false, error: 'Not connected', checkedAt: new Date() };
    }
    try {
      await this.sql`SELECT 1`;
      return { healthy: true, checkedAt: new Date() };
    } catch (e) {
      return { healthy: false, error: String(e), checkedAt: new Date() };
    }
  }

  async close(): Promise<void> {
    await this.sql?.end();
    this.sql = null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async discoverForeignKeys(tableNames: string[]): Promise<Map<string, FkEntry[]>> {
    if (!this.sql || tableNames.length === 0) return new Map();

    type FkRow = { table_name: string; column_name: string; foreign_table_name: string; foreign_column_name: string };

    const rows = await this.sql<FkRow[]>`
      SELECT
        kcu.table_name,
        kcu.column_name,
        ccu.table_name  AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON kcu.constraint_name = rc.constraint_name
        AND kcu.constraint_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = ANY(${tableNames})
    `.catch(() => [] as FkRow[]);

    const result = new Map<string, FkEntry[]>();
    for (const row of rows) {
      const existing = result.get(row.table_name) ?? [];
      existing.push({
        column: row.column_name,
        refTable: row.foreign_table_name,
        refColumn: row.foreign_column_name,
      });
      result.set(row.table_name, existing);
    }
    return result;
  }

  private async *syncTable(
    tableConf: TableConfig,
    options: SyncOptions,
  ): AsyncGenerator<SemanticEntity> {
    if (!this.sql) return;

    const tableName = tableConf.name;
    const cursor = options.lastSyncedAt && tableConf.updatedAtColumn
      ? options.lastSyncedAt
      : null;

    let offset = 0;

    while (true) {
      type Row = Record<string, unknown>;

      const rows = cursor && tableConf.updatedAtColumn
        ? await this.sql<Row[]>`
            SELECT * FROM ${this.sql(tableName)}
            WHERE ${this.sql(tableConf.updatedAtColumn)} > ${cursor}
            ORDER BY ${this.sql(tableConf.updatedAtColumn)} ASC
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
          `
        : await this.sql<Row[]>`
            SELECT * FROM ${this.sql(tableName)}
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
          `;

      if (rows.length === 0) break;

      for (const row of rows) {
        yield this.rowToEntity(row, tableConf);
      }

      if (rows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
  }

  private rowToEntity(row: Record<string, unknown>, tableConf: TableConfig): SemanticEntity {
    const id = String(row['id'] ?? row['ID'] ?? Object.values(row)[0] ?? 'unknown');
    const label = tableConf.labelColumn && row[tableConf.labelColumn]
      ? String(row[tableConf.labelColumn])
      : `${tableConf.name}:${id}`;

    const updatedAtValue = tableConf.updatedAtColumn ? row[tableConf.updatedAtColumn] : null;
    const lastModified =
      updatedAtValue instanceof Date
        ? updatedAtValue
        : typeof updatedAtValue === 'string'
          ? new Date(updatedAtValue)
          : new Date();

    const fks = this.fkMap.get(tableConf.name) ?? [];
    const relationships: SemanticEntity['relationships'] = [];

    const attributes: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(row)) {
      // Check if this column is a FK — if so, emit a relationship
      const fk = fks.find((f) => f.column === key);
      if (fk && value !== null && value !== undefined) {
        const refEntityType = this.tableEntityTypes.get(fk.refTable) ?? fk.refTable;
        relationships.push({
          type: 'belongs_to',
          targetId: `postgres:${refEntityType}:${String(value)}`,
        });
      }

      if (value === null || value === undefined) {
        attributes[key] = null;
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        attributes[key] = value;
      } else if (value instanceof Date) {
        attributes[key] = value.toISOString();
      } else {
        attributes[key] = String(value);
      }
    }

    return {
      id: `postgres:${tableConf.entityType}:${id}`,
      type: tableConf.entityType,
      label,
      attributes,
      relationships,
      lastModified,
      sourceId: `postgres:${tableConf.name}:${id}`,
    };
  }
}

function pgTypeToAttributeType(pgType: string): 'string' | 'number' | 'boolean' | 'date' {
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(pgType)) {
    return 'number';
  }
  if (pgType === 'boolean') return 'boolean';
  if (['timestamp', 'timestamptz', 'date', 'time', 'timetz'].some((t) => pgType.startsWith(t))) {
    return 'date';
  }
  return 'string';
}
