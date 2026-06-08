import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { ConnectorSchema, EntityTypeSchema, AttributeSchema } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'schema-evolution' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChangeKind = 'add_field' | 'remove_field' | 'rename_field' | 'change_type' | 'add_entity_type' | 'remove_entity_type';

export interface SchemaChange {
  kind: ChangeKind;
  entityType: string;
  /** Field name in the old schema (for rename: the old name) */
  fieldName?: string;
  /** For rename: the new field name */
  newFieldName?: string;
  /** For type changes: the new type */
  newType?: AttributeSchema['type'];
  breaking: boolean;
  description: string;
}

export interface FieldMapping {
  entityType: string;
  oldFieldName: string;
  newFieldName: string;
  /** Optional transform applied to values during migration. */
  transform?: (value: unknown) => unknown;
}

export interface SchemaVersion {
  connectorId: string;
  version: string;
  schema: ConnectorSchema;
  releasedAt: Date;
  breakingChanges: SchemaChange[];
}

export interface MigrationPlan {
  sourceVersion: string;
  targetVersion: string;
  changes: SchemaChange[];
  fieldMappings: FieldMapping[];
  affectedEntityTypes: string[];
  requiresReindex: boolean;
  estimatedAffectedCount?: number;
}

export interface SchemaEvolutionStore {
  getVersion(connectorId: string, version: string): Promise<SchemaVersion | null>;
  listVersions(connectorId: string): Promise<SchemaVersion[]>;
  saveVersion(v: SchemaVersion): Promise<void>;
  getMigrationStatus(
    workspaceId: string,
    connectorId: string,
    sourceVersion: string,
    targetVersion: string,
  ): Promise<MigrationStatus | null>;
  saveMigrationStatus(status: MigrationStatus): Promise<void>;
  updateMigrationStatus(
    workspaceId: string,
    connectorId: string,
    sourceVersion: string,
    targetVersion: string,
    update: Partial<MigrationStatus>,
  ): Promise<void>;
}

export interface MigrationStatus {
  workspaceId: string;
  connectorId: string;
  sourceVersion: string;
  targetVersion: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  affectedEntityCount?: number;
  errorMessage?: string;
}

export class SchemaEvolutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'SchemaEvolutionError';
  }
}

// ---------------------------------------------------------------------------
// SchemaEvolutionManager
// ---------------------------------------------------------------------------

/**
 * Manages connector schema versioning, change detection, and backwards-compatible migration.
 * Tracks schema versions over time and provides transformation functions for converting
 * entities between schema versions.
 */
export class SchemaEvolutionManager {
  constructor(private readonly store: SchemaEvolutionStore) {}

  /**
   * Record a new schema version for a connector.
   * Computes the diff against the previous version and classifies breaking changes.
   *
   * @param connectorId - Connector identifier
   * @param schema - New schema snapshot
   * @returns Computed changes vs previous version
   */
  async registerVersion(
    connectorId: string,
    schema: ConnectorSchema,
  ): Promise<Result<SchemaChange[], SchemaEvolutionError>> {
    const versions = await this.store.listVersions(connectorId);
    const prev = versions.at(-1);

    const changes = prev ? diffSchemas(prev.schema, schema) : detectNewSchema(schema);

    const version: SchemaVersion = {
      connectorId,
      version: schema.version,
      schema,
      releasedAt: new Date(),
      breakingChanges: changes.filter((c) => c.breaking),
    };

    await this.store.saveVersion(version);

    log.info('Schema version registered', {
      connectorId,
      version: schema.version,
      changeCount: changes.length,
      breakingCount: version.breakingChanges.length,
    });

    return ok(changes);
  }

  /**
   * Compute a migration plan from one schema version to another.
   * Includes detected changes, recommended field mappings, and reindex requirement.
   *
   * @param connectorId - Connector identifier
   * @param sourceVersion - Version currently in use
   * @param targetVersion - Version to migrate to
   */
  async buildMigrationPlan(
    connectorId: string,
    sourceVersion: string,
    targetVersion: string,
  ): Promise<Result<MigrationPlan, SchemaEvolutionError>> {
    const [source, target] = await Promise.all([
      this.store.getVersion(connectorId, sourceVersion),
      this.store.getVersion(connectorId, targetVersion),
    ]);

    if (!source) {
      return err(new SchemaEvolutionError(`Source version ${sourceVersion} not found`, 'VERSION_NOT_FOUND'));
    }
    if (!target) {
      return err(new SchemaEvolutionError(`Target version ${targetVersion} not found`, 'VERSION_NOT_FOUND'));
    }

    const changes = diffSchemas(source.schema, target.schema);
    const fieldMappings = deriveFieldMappings(changes);
    const affectedEntityTypes = [...new Set(changes.map((c) => c.entityType))];
    const requiresReindex = changes.some((c) => c.breaking || c.kind === 'change_type');

    const plan: MigrationPlan = {
      sourceVersion,
      targetVersion,
      changes,
      fieldMappings,
      affectedEntityTypes,
      requiresReindex,
    };

    return ok(plan);
  }

  /**
   * Transform an entity's attribute record from one schema version to another.
   * Applies field mappings (renames) and removes fields deleted in the target.
   *
   * @param entityType - Entity type being transformed
   * @param attributes - Attributes under the source schema
   * @param plan - Migration plan from buildMigrationPlan
   */
  transformAttributes(
    entityType: string,
    attributes: Record<string, unknown>,
    plan: MigrationPlan,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...attributes };

    // Apply renames
    for (const mapping of plan.fieldMappings) {
      if (mapping.entityType !== entityType && mapping.entityType !== '*') continue;
      if (Object.prototype.hasOwnProperty.call(result, mapping.oldFieldName)) {
        const rawValue = result[mapping.oldFieldName];
        result[mapping.newFieldName] = mapping.transform ? mapping.transform(rawValue) : rawValue;
        delete result[mapping.oldFieldName];
      }
    }

    // Remove fields deleted in target schema
    for (const change of plan.changes) {
      if (change.entityType !== entityType) continue;
      if (change.kind === 'remove_field' && change.fieldName) {
        delete result[change.fieldName];
      }
    }

    return result;
  }

  /**
   * List all registered schema versions for a connector.
   *
   * @param connectorId - Connector identifier
   */
  async listVersions(connectorId: string): Promise<SchemaVersion[]> {
    return this.store.listVersions(connectorId);
  }

  /**
   * Start or resume a workspace-scoped migration.
   *
   * @param workspaceId - Workspace running the migration
   * @param plan - Migration plan (from buildMigrationPlan)
   * @param affectedEntityCount - Total entities to migrate
   */
  async startMigration(
    workspaceId: string,
    connectorId: string,
    plan: MigrationPlan,
    affectedEntityCount?: number,
  ): Promise<Result<MigrationStatus, SchemaEvolutionError>> {
    const existing = await this.store.getMigrationStatus(
      workspaceId,
      connectorId,
      plan.sourceVersion,
      plan.targetVersion,
    );

    if (existing?.status === 'completed') {
      return err(new SchemaEvolutionError('Migration already completed', 'ALREADY_COMPLETED'));
    }

    const status: MigrationStatus = {
      workspaceId,
      connectorId,
      sourceVersion: plan.sourceVersion,
      targetVersion: plan.targetVersion,
      status: 'in_progress',
      startedAt: new Date(),
      ...(affectedEntityCount !== undefined && { affectedEntityCount }),
    };

    await this.store.saveMigrationStatus(status);
    log.info('Migration started', { workspaceId, connectorId, ...plan });
    return ok(status);
  }

  /**
   * Mark a migration as completed or failed.
   *
   * @param workspaceId - Workspace ID
   * @param outcome - Final status
   * @param errorMessage - Set if outcome is 'failed'
   */
  async completeMigration(
    workspaceId: string,
    connectorId: string,
    sourceVersion: string,
    targetVersion: string,
    outcome: 'completed' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    await this.store.updateMigrationStatus(workspaceId, connectorId, sourceVersion, targetVersion, {
      status: outcome,
      completedAt: new Date(),
      ...(errorMessage !== undefined && { errorMessage }),
    });
    log.info('Migration complete', { workspaceId, connectorId, sourceVersion, targetVersion, outcome });
  }
}

// ---------------------------------------------------------------------------
// Pure diff helpers
// ---------------------------------------------------------------------------

/**
 * Compute the set of changes between two connector schemas.
 * Returns changes sorted: entity-type changes first, then field-level changes.
 */
export function diffSchemas(prev: ConnectorSchema, next: ConnectorSchema): SchemaChange[] {
  const changes: SchemaChange[] = [];

  const prevTypes = new Map(prev.entityTypes.map((t) => [t.name, t]));
  const nextTypes = new Map(next.entityTypes.map((t) => [t.name, t]));

  // Removed entity types
  for (const [name] of prevTypes) {
    if (!nextTypes.has(name)) {
      changes.push({
        kind: 'remove_entity_type',
        entityType: name,
        breaking: true,
        description: `Entity type "${name}" removed`,
      });
    }
  }

  // Added entity types
  for (const [name] of nextTypes) {
    if (!prevTypes.has(name)) {
      changes.push({
        kind: 'add_entity_type',
        entityType: name,
        breaking: false,
        description: `Entity type "${name}" added`,
      });
    }
  }

  // Field-level diff for shared entity types
  for (const [typeName, nextType] of nextTypes) {
    const prevType = prevTypes.get(typeName);
    if (!prevType) continue;
    const fieldChanges = diffFields(typeName, prevType, nextType);
    changes.push(...fieldChanges);
  }

  return changes;
}

function diffFields(
  entityType: string,
  prev: EntityTypeSchema,
  next: EntityTypeSchema,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const prevFields = new Map(prev.attributes.map((a) => [a.name, a]));
  const nextFields = new Map(next.attributes.map((a) => [a.name, a]));

  // Removed fields
  for (const [name] of prevFields) {
    if (!nextFields.has(name)) {
      changes.push({
        kind: 'remove_field',
        entityType,
        fieldName: name,
        breaking: true,
        description: `Field "${name}" removed from "${entityType}"`,
      });
    }
  }

  // Added or changed fields
  for (const [name, nextAttr] of nextFields) {
    const prevAttr = prevFields.get(name);
    if (!prevAttr) {
      changes.push({
        kind: 'add_field',
        entityType,
        fieldName: name,
        breaking: false,
        description: `Field "${name}" added to "${entityType}"`,
      });
    } else if (prevAttr.type !== nextAttr.type) {
      changes.push({
        kind: 'change_type',
        entityType,
        fieldName: name,
        newType: nextAttr.type,
        breaking: true,
        description: `Field "${name}" type changed from "${prevAttr.type}" to "${nextAttr.type}" in "${entityType}"`,
      });
    }
  }

  return changes;
}

function detectNewSchema(schema: ConnectorSchema): SchemaChange[] {
  return schema.entityTypes.map((t) => ({
    kind: 'add_entity_type' as const,
    entityType: t.name,
    breaking: false,
    description: `Initial registration of entity type "${t.name}"`,
  }));
}

/**
 * Infer probable field renames from remove+add pairs on the same entity type.
 * A rename is inferred when a removed field name and an added field name are
 * within edit-distance 2 (simple heuristic for obvious typo-fixes).
 */
function deriveFieldMappings(changes: SchemaChange[]): FieldMapping[] {
  const mappings: FieldMapping[] = [];
  const removedByType = groupBy(
    changes.filter((c) => c.kind === 'remove_field' && c.fieldName),
    (c) => c.entityType,
  );
  const addedByType = groupBy(
    changes.filter((c) => c.kind === 'add_field' && c.fieldName),
    (c) => c.entityType,
  );

  for (const [entityType, removed] of removedByType) {
    const added = addedByType.get(entityType) ?? [];
    for (const rem of removed) {
      const match = added.find(
        (a) => a.fieldName && rem.fieldName && editDistance(rem.fieldName, a.fieldName) <= 2,
      );
      if (match && rem.fieldName && match.fieldName) {
        mappings.push({ entityType, oldFieldName: rem.fieldName, newFieldName: match.fieldName });
      }
    }
  }

  return mappings;
}

function groupBy<T>(arr: T[], key: (v: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) existing.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j!] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}
