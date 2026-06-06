import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw Airtable API types ──────────────────────────────────────────────────

export interface AirtableBase {
  id: string;
  name: string;
  permissionLevel: string;
}

export interface AirtableField {
  id: string;
  name: string;
  type: string;
}

export interface AirtableTable {
  id: string;
  name: string;
  fields: AirtableField[];
}

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * @param base      - Raw Airtable base object
 * @returns SemanticEntity representing the base
 */
export function transformBase(base: AirtableBase): SemanticEntity {
  return {
    id: `airtable:base:${base.id}`,
    type: 'base',
    label: base.name,
    attributes: {
      permissionLevel: base.permissionLevel,
    },
    relationships: [],
    lastModified: new Date(),
    sourceId: `airtable:base:${base.id}`,
  };
}

/**
 * @param record    - Raw Airtable record object
 * @param baseId    - Parent base ID
 * @param tableId   - Parent table ID
 * @param tableName - Human-readable table name (used as entity label prefix)
 * @param fields    - Field schema from the table definition
 * @returns SemanticEntity representing the record
 */
export function transformRecord(
  record: AirtableRecord,
  baseId: string,
  tableId: string,
  tableName: string,
  fields: AirtableField[],
): SemanticEntity {
  const fieldNames = new Set(fields.map((f) => f.name));

  // Build attributes from record fields, filtering to known schema fields
  const attributes: SemanticEntity['attributes'] = {};
  for (const [key, value] of Object.entries(record.fields)) {
    if (!fieldNames.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      attributes[key] = value;
    }
  }

  // Derive a human-readable label from the first text field, or fall back to record ID
  const nameField = fields.find((f) => f.type === 'singleLineText' || f.type === 'multilineText');
  const label = nameField && typeof record.fields[nameField.name] === 'string'
    ? `${tableName}: ${String(record.fields[nameField.name])}`
    : `${tableName}: ${record.id}`;

  return {
    id: `airtable:record:${baseId}:${tableId}:${record.id}`,
    type: 'record',
    label,
    attributes,
    relationships: [
      { type: 'belongs_to', targetId: `airtable:base:${baseId}` },
    ],
    lastModified: new Date(record.createdTime),
    sourceId: `airtable:record:${record.id}`,
  };
}
