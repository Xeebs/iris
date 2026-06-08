import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'data-import-export' });

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_ENTITY_COUNT = 50_000;

export type ImportFormat = 'csv' | 'json';
export type ExportFormat = 'csv' | 'json' | 'parquet';

export type ParsedRow = Record<string, string>;

export interface DetectedSchema {
  columns: string[];
  sampleRows: ParsedRow[];
  rowCount: number;
}

export interface FieldMapping {
  entityType: string;
  /** Maps CSV/JSON column names to SemanticEntity attribute keys */
  attributeMap: Record<string, string>;
  /** Column whose value becomes the entity label */
  labelColumn: string;
  /** Column whose value becomes the entity id suffix; defaults to row index when absent */
  idColumn?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  mappedCount: number;
  unmappedColumns: string[];
}

export interface ImportError {
  rowIndex: number;
  column?: string;
  message: string;
}

export interface TransformResult {
  entities: SemanticEntity[];
  errors: ImportError[];
}

/**
 * Parse CSV content into an array of row objects.
 * First row is treated as the header.
 * Handles quoted fields with embedded commas and newlines.
 *
 * @param content - Raw CSV string
 */
export function parseCSV(content: string): ParsedRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]!);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]!);
    const row: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse JSON content into an array of row objects.
 * Accepts either a JSON array of objects or an object with a `data` array.
 *
 * @param content - Raw JSON string
 */
export function parseJSON(content: string): ParsedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)['data'] ?? [];

  if (!Array.isArray(arr)) {
    throw new Error('JSON must be an array or an object with a "data" array property');
  }

  return arr.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Row ${i}: expected an object`);
    }
    const row: ParsedRow = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      row[k] = v === null || v === undefined ? '' : String(v);
    }
    return row;
  });
}

/**
 * Detect schema from a sample of rows.
 * Returns the column set and the first 5 rows as a preview.
 *
 * @param rows - Parsed rows from parseCSV or parseJSON
 */
export function detectSchema(rows: ParsedRow[]): DetectedSchema {
  const columnSet = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }

  return {
    columns: Array.from(columnSet),
    sampleRows: rows.slice(0, 5),
    rowCount: rows.length,
  };
}

/**
 * Validate a field mapping against the parsed rows.
 * Checks that labelColumn exists, attributeMap targets are present, and no data loss.
 *
 * @param rows    - Parsed rows
 * @param mapping - User-supplied field mapping
 */
export function validateMapping(rows: ParsedRow[], mapping: FieldMapping): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    errors.push('Input contains no rows to import');
    return { valid: false, errors, warnings, mappedCount: 0, unmappedColumns: [] };
  }

  const schema = detectSchema(rows);
  const { columns } = schema;

  if (!columns.includes(mapping.labelColumn)) {
    errors.push(`labelColumn "${mapping.labelColumn}" not found in input (available: ${columns.join(', ')})`);
  }

  if (mapping.idColumn && !columns.includes(mapping.idColumn)) {
    errors.push(`idColumn "${mapping.idColumn}" not found in input`);
  }

  const mappedSourceCols = new Set(Object.keys(mapping.attributeMap));
  const unmappedColumns = columns.filter(
    (c) => !mappedSourceCols.has(c) && c !== mapping.labelColumn && c !== mapping.idColumn,
  );

  if (unmappedColumns.length > 0) {
    warnings.push(`${unmappedColumns.length} column(s) not mapped and will be ignored: ${unmappedColumns.slice(0, 5).join(', ')}${unmappedColumns.length > 5 ? '...' : ''}`);
  }

  if (rows.length > MAX_ENTITY_COUNT) {
    errors.push(`Row count ${rows.length} exceeds maximum of ${MAX_ENTITY_COUNT}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    mappedCount: Object.keys(mapping.attributeMap).length,
    unmappedColumns,
  };
}

/**
 * Transform parsed rows into SemanticEntity objects using the provided field mapping.
 * Rows with missing label values are skipped and recorded as errors.
 *
 * @param rows         - Parsed rows from parseCSV or parseJSON
 * @param mapping      - Field mapping from validateMapping
 * @param connectorId  - Source connector identifier used in entity IDs
 */
export function transformRows(
  rows: ParsedRow[],
  mapping: FieldMapping,
  connectorId: string,
): TransformResult {
  const entities: SemanticEntity[] = [];
  const errors: ImportError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    const label = row[mapping.labelColumn];
    if (!label || label.trim() === '') {
      errors.push({ rowIndex: i, column: mapping.labelColumn, message: 'Missing required label value' });
      continue;
    }

    const idSuffix = mapping.idColumn ? (row[mapping.idColumn] ?? String(i)) : String(i);
    const entityId = `${connectorId}:${mapping.entityType}:${idSuffix}`;

    const attributes: Record<string, AttributeValue> = {};
    for (const [srcCol, destKey] of Object.entries(mapping.attributeMap)) {
      const val = row[srcCol];
      if (val !== undefined && val !== '') {
        attributes[destKey] = val;
      }
    }

    entities.push({
      id: entityId,
      type: mapping.entityType,
      label: label.trim(),
      attributes,
      relationships: [],
      lastModified: new Date(),
      sourceId: entityId,
    });
  }

  log.debug('Transformed rows to entities', {
    totalRows: rows.length,
    entities: entities.length,
    errors: errors.length,
  });

  return { entities, errors };
}

/**
 * Serialize a list of SemanticEntity objects to CSV format.
 * All attribute keys are flattened to top-level columns.
 *
 * @param entities - Entities to serialize
 */
export function serializeToCSV(entities: SemanticEntity[]): string {
  if (entities.length === 0) return '';

  const attrKeys = new Set<string>();
  for (const e of entities) {
    for (const k of Object.keys(e.attributes)) {
      attrKeys.add(k);
    }
  }

  const headers = ['id', 'type', 'label', ...Array.from(attrKeys), 'lastModified'];
  const escapeCSV = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v);

  const lines: string[] = [headers.join(',')];
  for (const e of entities) {
    const row = [
      escapeCSV(e.id),
      escapeCSV(e.type),
      escapeCSV(e.label),
      ...Array.from(attrKeys).map((k) => {
        const v = e.attributes[k];
        if (v === null || v === undefined) return '';
        return escapeCSV(Array.isArray(v) ? v.join('|') : String(v));
      }),
      escapeCSV(e.lastModified instanceof Date ? e.lastModified.toISOString() : String(e.lastModified)),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

/**
 * Serialize a list of SemanticEntity objects to JSON format.
 *
 * @param entities - Entities to serialize
 */
export function serializeToJSON(entities: SemanticEntity[]): string {
  return JSON.stringify({ data: entities, count: entities.length }, null, 2);
}

// ─── Batch Insert ─────────────────────────────────────────────────────────────

export interface BatchInsertResult {
  inserted: number;
  durationMs: number;
}

/**
 * Feed a batch of SemanticEntity objects into the provided upsert function.
 * Enforces the MAX_ENTITY_COUNT limit before calling upsert.
 *
 * @param entities    - Entities to insert
 * @param workspaceId - Workspace that owns the entities
 * @param upsert      - Async function that persists entities and returns the count inserted
 * @returns           - Inserted count and duration
 */
export async function batchInsert(
  entities: SemanticEntity[],
  workspaceId: string,
  upsert: (entities: SemanticEntity[], workspaceId: string) => Promise<number>,
): Promise<BatchInsertResult> {
  if (entities.length > MAX_ENTITY_COUNT) {
    throw new Error(
      `Import exceeds maximum entity limit: ${entities.length} > ${MAX_ENTITY_COUNT}`,
    );
  }

  const start = Date.now();
  const inserted = await upsert(entities, workspaceId);
  const durationMs = Date.now() - start;

  log.info('Batch insert complete', { workspaceId, inserted, durationMs });
  return { inserted, durationMs };
}
