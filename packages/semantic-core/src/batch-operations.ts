import { z } from 'zod';
import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportFormat = 'csv' | 'json';
export type ExportFormat = 'csv' | 'json';

export type ImportRecord = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  relationships?: { type: string; targetId: string }[];
  lastModified?: string;
  sourceId?: string;
};

export type BatchValidationError = {
  row: number;
  field: string;
  message: string;
};

export type BatchValidationResult = {
  valid: ImportRecord[];
  errors: BatchValidationError[];
};

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ImportJobResult = {
  jobId: string;
  status: ImportJobStatus;
  totalRecords: number;
  importedCount: number;
  errorCount: number;
  errors: BatchValidationError[];
};

export type ExportFilter = {
  entityType?: string;
  connectorId?: string;
  updatedAfter?: Date;
};

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ImportRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  attributes: z.record(z.unknown()).default({}),
  relationships: z
    .array(z.object({ type: z.string(), targetId: z.string() }))
    .optional()
    .default([]),
  lastModified: z.string().optional(),
  sourceId: z.string().optional(),
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON buffer into an array of import records.
 */
export function parseJsonImport(buffer: string): ImportRecord[] {
  const parsed: unknown = JSON.parse(buffer);
  if (!Array.isArray(parsed)) {
    throw new Error('JSON import must be an array of entity records');
  }
  return parsed as ImportRecord[];
}

/**
 * Parse a CSV string into an array of raw record objects.
 * Handles quoted fields and escaped commas.
 */
export function parseCsvImport(csv: string): ImportRecord[] {
  const lines = csv.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row');
  }

  const headers = splitCsvLine(lines[0]!);
  const records: ImportRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = values[idx] ?? '';
    });

    let attributes: Record<string, unknown> = {};
    try {
      attributes = raw['attributes'] ? (JSON.parse(raw['attributes']) as Record<string, unknown>) : {};
    } catch {
      // attributes field is not valid JSON — treat as empty
    }

    const relationships: { type: string; targetId: string }[] = [];
    try {
      const rel = raw['relationships'] ? JSON.parse(raw['relationships']) : [];
      if (Array.isArray(rel)) relationships.push(...(rel as { type: string; targetId: string }[]));
    } catch {
      // skip malformed relationships
    }

    records.push({
      id: raw['id'] ?? '',
      type: raw['type'] ?? '',
      label: raw['label'] ?? '',
      attributes,
      relationships,
      ...(raw['lastModified'] ? { lastModified: raw['lastModified'] } : {}),
      ...(raw['sourceId'] ? { sourceId: raw['sourceId'] } : {}),
    });
  }

  return records;
}

/**
 * Split a single CSV line respecting quoted fields.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
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
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Validate a list of raw import records against the entity schema.
 */
export function validateBatch(records: ImportRecord[]): BatchValidationResult {
  const valid: ImportRecord[] = [];
  const errors: BatchValidationError[] = [];

  records.forEach((rec, idx) => {
    const row = idx + 1;
    const result = ImportRecordSchema.safeParse(rec);
    if (result.success) {
      valid.push(result.data as ImportRecord);
    } else {
      for (const issue of result.error.issues) {
        errors.push({
          row,
          field: issue.path.join('.') || 'unknown',
          message: issue.message,
        });
      }
    }
  });

  return { valid, errors };
}

/**
 * Convert a validated ImportRecord to a SemanticEntity.
 */
export function toSemanticEntity(record: ImportRecord, workspaceId: string): SemanticEntity {
  return {
    id: `${workspaceId}:${record.id}`,
    type: record.type,
    label: record.label,
    attributes: record.attributes as SemanticEntity['attributes'],
    relationships: record.relationships ?? [],
    lastModified: record.lastModified ? new Date(record.lastModified) : new Date(),
    sourceId: record.sourceId ?? record.id,
  };
}

/**
 * Serialize entities to JSON for export.
 */
export function serializeToJson(entities: SemanticEntity[]): string {
  return JSON.stringify(
    entities.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      attributes: e.attributes,
      relationships: e.relationships,
      lastModified: e.lastModified instanceof Date ? e.lastModified.toISOString() : e.lastModified,
      sourceId: e.sourceId,
    })),
    null,
    2,
  );
}

/**
 * Serialize entities to CSV for export.
 */
export function serializeToCsv(entities: SemanticEntity[]): string {
  const header = 'id,type,label,attributes,relationships,lastModified,sourceId';
  const rows = entities.map((e) => {
    const cols = [
      e.id,
      e.type,
      e.label,
      JSON.stringify(e.attributes),
      JSON.stringify(e.relationships),
      e.lastModified instanceof Date ? e.lastModified.toISOString() : String(e.lastModified ?? ''),
      e.sourceId ?? '',
    ];
    return cols.map(csvEscape).join(',');
  });
  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── BatchOperations class ────────────────────────────────────────────────────

export type SqlFn = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — required for jsonb columns (plain strings are stored as jsonb string scalars) */
  json(value: unknown): unknown;
};

/**
 * Orchestrates batch import/export operations against the entity store.
 */
export class BatchOperations {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Parse a raw file buffer into import records based on format.
   *
   * @param buffer - Raw file content as string
   * @param format - 'csv' or 'json'
   */
  parseImportFile(buffer: string, format: ImportFormat): ImportRecord[] {
    if (format === 'json') return parseJsonImport(buffer);
    return parseCsvImport(buffer);
  }

  /**
   * Bulk insert validated entities into the iris_entities table.
   * Uses ON CONFLICT DO UPDATE for idempotent upsert.
   *
   * @param workspaceId - Target workspace
   * @param records - Already-validated import records
   */
  async importBatch(workspaceId: string, records: ImportRecord[]): Promise<ImportJobResult> {
    const jobId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const errors: BatchValidationError[] = [];
    let importedCount = 0;

    const CHUNK = 100;
    for (let offset = 0; offset < records.length; offset += CHUNK) {
      const slice = records.slice(offset, offset + CHUNK);
      for (const record of slice) {
        const entity = toSemanticEntity(record, workspaceId);
        try {
          await this.sql`
            INSERT INTO iris_entities
              (id, workspace_id, type, label, attributes, relationships, last_modified, source_id)
            VALUES (
              ${entity.id},
              ${workspaceId},
              ${entity.type},
              ${entity.label},
              ${this.sql.json(entity.attributes)},
              ${this.sql.json(entity.relationships)},
              ${entity.lastModified instanceof Date ? entity.lastModified.toISOString() : new Date().toISOString()},
              ${entity.sourceId}
            )
            ON CONFLICT (id) DO UPDATE SET
              label       = EXCLUDED.label,
              attributes  = EXCLUDED.attributes,
              relationships = EXCLUDED.relationships,
              last_modified = EXCLUDED.last_modified
          `;
          importedCount++;
        } catch (e) {
          errors.push({
            row: offset + slice.indexOf(record) + 1,
            field: 'id',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      jobId,
      status: errors.length === records.length ? 'failed' : 'completed',
      totalRecords: records.length,
      importedCount,
      errorCount: errors.length,
      errors,
    };
  }

  /**
   * Export entities matching the given filter.
   *
   * @param workspaceId - Source workspace
   * @param filter - Optional filter criteria
   * @param format - Output format ('json' or 'csv')
   */
  async exportBatch(
    workspaceId: string,
    filter: ExportFilter,
    format: ExportFormat,
  ): Promise<string> {
    type EntityRow = {
      id: string;
      type: string;
      label: string;
      attributes: Record<string, unknown>;
      relationships: { type: string; targetId: string }[];
      last_modified: string | Date;
      source_id: string;
    };

    let rows: EntityRow[];

    if (filter.entityType && filter.updatedAfter) {
      rows = (await this.sql`
        SELECT id, type, label, attributes, relationships, last_modified, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND type = ${filter.entityType}
          AND last_modified > ${filter.updatedAfter.toISOString()}
        ORDER BY last_modified DESC
      `) as EntityRow[];
    } else if (filter.entityType) {
      rows = (await this.sql`
        SELECT id, type, label, attributes, relationships, last_modified, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND type = ${filter.entityType}
        ORDER BY last_modified DESC
      `) as EntityRow[];
    } else if (filter.updatedAfter) {
      rows = (await this.sql`
        SELECT id, type, label, attributes, relationships, last_modified, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
          AND last_modified > ${filter.updatedAfter.toISOString()}
        ORDER BY last_modified DESC
      `) as EntityRow[];
    } else {
      rows = (await this.sql`
        SELECT id, type, label, attributes, relationships, last_modified, source_id
        FROM iris_entities
        WHERE workspace_id = ${workspaceId}
        ORDER BY last_modified DESC
      `) as EntityRow[];
    }

    const entities: SemanticEntity[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      label: r.label,
      attributes: r.attributes as SemanticEntity['attributes'],
      relationships: r.relationships as SemanticEntity['relationships'],
      lastModified: r.last_modified instanceof Date ? r.last_modified : new Date(r.last_modified),
      sourceId: r.source_id,
    }));

    return format === 'csv' ? serializeToCsv(entities) : serializeToJson(entities);
  }
}
