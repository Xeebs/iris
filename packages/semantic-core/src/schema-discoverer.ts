import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'schema-discoverer' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type InferredFieldType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'id' | 'unknown';

export interface DiscoveredField {
  name: string;
  inferredType: InferredFieldType;
  isPii: boolean;
  accepted: boolean;
  renamedTo?: string | undefined;
  sampleValues: string[];
  nullRate: number;
  confidence: number;
}

export interface DiscoveredEntityType {
  name: string;
  fields: DiscoveredField[];
  rowCount: number;
}

export interface DiscoveredSchema {
  entityTypes: DiscoveredEntityType[];
  rawDataFormat: 'csv' | 'json' | 'parquet' | 'unknown';
  discoveredAt: Date;
}

export interface SchemaConfirmation {
  instanceId: string;
  workspaceId: string;
  entityType: string;
  fields: SchemaFieldDecision[];
  confirmedAt: Date;
}

export interface SchemaFieldDecision {
  originalName: string;
  accepted: boolean;
  renamedTo?: string | undefined;
  isPii: boolean;
  entityRelationshipType?: string | undefined;
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
const ID_FIELD_HINTS = new Set(['id', '_id', 'uuid', 'guid', 'key', 'pk', 'ref']);
const PII_FIELD_HINTS = new Set([
  'email', 'email_address', 'phone', 'phone_number', 'mobile', 'ssn',
  'social_security', 'credit_card', 'card_number', 'date_of_birth', 'dob',
  'address', 'street_address', 'postal_code', 'zip', 'passport', 'national_id',
  'bank_account', 'account_number', 'routing_number', 'tax_id',
]);

function inferType(fieldName: string, samples: unknown[]): InferredFieldType {
  const lower = fieldName.toLowerCase().replace(/[\s-]/g, '_');

  if (ID_FIELD_HINTS.has(lower) || lower.endsWith('_id')) return 'id';

  const strSamples = samples.filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (strSamples.length === 0 && samples.length > 0) {
    if (samples.every(s => typeof s === 'number')) return 'number';
    if (samples.every(s => typeof s === 'boolean')) return 'boolean';
  }

  if (strSamples.length > 0) {
    if (strSamples.every(s => EMAIL_RE.test(s))) return 'email';
    if (strSamples.every(s => URL_RE.test(s))) return 'url';
    if (strSamples.every(s => DATE_RE.test(s))) return 'date';
    if (strSamples.every(s => !isNaN(Number(s)))) return 'number';
    if (strSamples.every(s => s === 'true' || s === 'false')) return 'boolean';
  }

  return 'string';
}

function isPiiField(fieldName: string, inferredType: InferredFieldType): boolean {
  const lower = fieldName.toLowerCase().replace(/[\s-]/g, '_');
  return PII_FIELD_HINTS.has(lower) || inferredType === 'email';
}

function confidenceScore(samples: unknown[], nullRate: number): number {
  if (samples.length === 0) return 0;
  const diversity = new Set(samples.map(String)).size / samples.length;
  return Math.round(Math.min(1, (1 - nullRate) * (0.5 + diversity * 0.5)) * 100) / 100;
}

// ─── Schema Discovery ─────────────────────────────────────────────────────────

/**
 * Infer a schema from sample JSON records.
 * Returns a `DiscoveredEntityType` with per-field metadata.
 *
 * @param entityTypeName - Logical name for this entity type (e.g., "customer")
 * @param sampleData     - Array of plain objects representing sample rows
 */
export function discoverJsonSchema(
  entityTypeName: string,
  sampleData: Record<string, unknown>[],
): DiscoveredEntityType {
  if (sampleData.length === 0) {
    return { name: entityTypeName, fields: [], rowCount: 0 };
  }

  const allKeys = new Set<string>();
  for (const row of sampleData) {
    for (const key of Object.keys(row)) allKeys.add(key);
  }

  const fields: DiscoveredField[] = [];

  for (const key of allKeys) {
    const allValues = sampleData.map(r => r[key]);
    const nonNull = allValues.filter(v => v !== null && v !== undefined && v !== '');
    const nullRate = 1 - nonNull.length / allValues.length;
    const samples = nonNull.slice(0, 5).map(String);

    const inferredType = inferType(key, nonNull);
    const isPii = isPiiField(key, inferredType);

    fields.push({
      name: key,
      inferredType,
      isPii,
      accepted: true,
      sampleValues: samples,
      nullRate: Math.round(nullRate * 100) / 100,
      confidence: confidenceScore(nonNull, nullRate),
    });
  }

  return { name: entityTypeName, fields, rowCount: sampleData.length };
}

/**
 * Infer a schema from CSV header + data rows.
 * Rows are string arrays; header is the first row (already extracted).
 *
 * @param entityTypeName - Logical name for this entity type
 * @param headers        - Column names
 * @param rows           - Data rows (arrays of strings)
 */
export function discoverCsvSchema(
  entityTypeName: string,
  headers: string[],
  rows: string[][],
): DiscoveredEntityType {
  const records: Record<string, unknown>[] = rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])),
  );
  return discoverJsonSchema(entityTypeName, records);
}

/**
 * Discover schema for multiple entity types from a map of sample data.
 *
 * @param samples - Map of entity type name → sample rows
 */
export function discoverSchema(
  samples: Record<string, Record<string, unknown>[]>,
): DiscoveredSchema {
  const entityTypes = Object.entries(samples).map(([name, rows]) =>
    discoverJsonSchema(name, rows),
  );

  log.info('Schema discovered', {
    entityTypes: entityTypes.map(e => e.name),
    totalRows: entityTypes.reduce((n, e) => n + e.rowCount, 0),
  });

  return {
    entityTypes,
    rawDataFormat: 'json',
    discoveredAt: new Date(),
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

type SqlClient = ReturnType<typeof postgres>;

interface SchemaOverrideRow {
  id: string;
  instance_id: string;
  workspace_id: string;
  entity_type: string;
  fields: string;
  confirmed_at: Date;
}

/**
 * Persists and retrieves human-in-the-loop schema confirmations.
 */
export class SchemaDiscovererService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Persist a user's schema field decisions for a connector instance.
   *
   * @param instanceId   - Connector instance ID
   * @param workspaceId  - Workspace owning the instance
   * @param entityType   - Entity type this confirmation applies to
   * @param fields       - Per-field decisions from the user
   */
  async saveConfirmation(
    instanceId: string,
    workspaceId: string,
    entityType: string,
    fields: SchemaFieldDecision[],
  ): Promise<Result<SchemaConfirmation, Error>> {
    const fieldsJson = JSON.stringify(fields);
    try {
      await this.sql`
        INSERT INTO schema_overrides (instance_id, workspace_id, entity_type, fields)
        VALUES (${instanceId}, ${workspaceId}, ${entityType}, ${fieldsJson}::jsonb)
        ON CONFLICT (instance_id, entity_type) DO UPDATE
          SET fields       = EXCLUDED.fields,
              confirmed_at = NOW(),
              updated_at   = NOW()
      `;
      log.info('Schema confirmation saved', { instanceId, workspaceId, entityType });
      return ok({ instanceId, workspaceId, entityType, fields, confirmedAt: new Date() });
    } catch (e) {
      log.error('Failed to save schema confirmation', { instanceId, entityType, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Load schema overrides for a connector instance.
   * Returns an empty array if no confirmations exist yet.
   *
   * @param instanceId  - Connector instance ID
   * @param workspaceId - Workspace owning the instance
   */
  async getConfirmations(
    instanceId: string,
    workspaceId: string,
  ): Promise<Result<SchemaConfirmation[], Error>> {
    try {
      const rows = await this.sql<SchemaOverrideRow[]>`
        SELECT id, instance_id, workspace_id, entity_type, fields, confirmed_at
        FROM schema_overrides
        WHERE instance_id = ${instanceId} AND workspace_id = ${workspaceId}
        ORDER BY entity_type ASC
      `;
      const confirmations: SchemaConfirmation[] = rows.map(r => ({
        instanceId: r.instance_id,
        workspaceId: r.workspace_id,
        entityType: r.entity_type,
        fields: JSON.parse(r.fields) as SchemaFieldDecision[],
        confirmedAt: r.confirmed_at,
      }));
      return ok(confirmations);
    } catch (e) {
      log.error('Failed to get schema confirmations', { instanceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete all schema overrides for a connector instance.
   *
   * @param instanceId  - Connector instance ID
   * @param workspaceId - Workspace owning the instance
   */
  async deleteConfirmations(instanceId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM schema_overrides WHERE instance_id = ${instanceId} AND workspace_id = ${workspaceId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
