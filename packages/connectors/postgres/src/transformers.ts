import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';
import type { TableConfig } from './postgres-connector.js';

/**
 * Convert a raw Postgres row to an Iris SemanticEntity.
 * Handles null coercion, Date ISO serialization, and label extraction.
 *
 * @param row - Raw row from Postgres (column name → value)
 * @param tableConf - Table config describing entityType, labelColumn, updatedAtColumn
 * @returns SemanticEntity with type, label, attributes, and relationships
 */
export function rowToEntity(
  row: Record<string, unknown>,
  tableConf: TableConfig
): SemanticEntity {
  const id = String(row['id'] ?? row['ID'] ?? Object.values(row)[0] ?? 'unknown');
  const label =
    tableConf.labelColumn && row[tableConf.labelColumn]
      ? String(row[tableConf.labelColumn])
      : `${tableConf.name}:${id}`;

  const updatedAtValue = tableConf.updatedAtColumn ? row[tableConf.updatedAtColumn] : null;
  const lastModified =
    updatedAtValue instanceof Date
      ? updatedAtValue
      : typeof updatedAtValue === 'string'
        ? new Date(updatedAtValue)
        : new Date();

  const attributes: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(row)) {
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
    relationships: [],
    lastModified,
    sourceId: `postgres:${tableConf.name}:${id}`,
  };
}
