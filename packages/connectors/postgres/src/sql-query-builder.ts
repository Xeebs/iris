/**
 * Utility for building type-safe Postgres query fragments for the Iris Postgres connector.
 * Uses string-based building since postgres tagged templates can't be easily composed.
 */

import type { TableConfig } from './postgres-connector.js';

export type QuerySpec = {
  tableName: string;
  updatedAtColumn: string | undefined;
  sinceDate: Date | null;
  batchSize: number;
  offset: number;
};

/**
 * Build a type descriptor for a postgres column.
 * Returns the Iris attribute type equivalent.
 *
 * @param pgType - Postgres data type string from information_schema
 * @returns Attribute type
 */
export function pgTypeToAttributeType(pgType: string): 'string' | 'number' | 'boolean' | 'date' {
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(pgType)) {
    return 'number';
  }
  if (pgType === 'boolean') return 'boolean';
  if (['timestamp', 'timestamptz', 'date', 'time', 'timetz'].some(t => pgType.startsWith(t))) {
    return 'date';
  }
  return 'string';
}

/**
 * Determine whether a table sync needs the incremental (WHERE updated_at > cursor) path.
 *
 * @param tableConf - Table configuration from connector config
 * @param lastSyncedAt - Optional cursor from previous sync
 */
export function isIncrementalSync(
  tableConf: Pick<TableConfig, 'updatedAtColumn'>,
  lastSyncedAt: Date | undefined
): boolean {
  return !!(tableConf.updatedAtColumn && lastSyncedAt);
}

/**
 * Build a human-readable query description for logging.
 *
 * @param spec - Query parameters
 * @returns Log-friendly string
 */
export function describeQuery(spec: QuerySpec): string {
  const base = `SELECT * FROM ${spec.tableName}`;
  const where = spec.sinceDate && spec.updatedAtColumn
    ? ` WHERE ${spec.updatedAtColumn} > ${spec.sinceDate.toISOString()}`
    : '';
  return `${base}${where} LIMIT ${spec.batchSize} OFFSET ${spec.offset}`;
}
