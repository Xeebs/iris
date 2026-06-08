import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';

const log = logger.child({ service: 'entity-validator' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Rule Definitions ─────────────────────────────────────────────────────────

export type RuleType =
  | 'required'
  | 'type'
  | 'regex'
  | 'cross_field'
  | 'email'
  | 'phone'
  | 'min_length'
  | 'max_length'
  | 'enum'
  | 'range';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationRuleDefinition =
  | { type: 'required'; field: string }
  | { type: 'type'; field: string; expectedType: 'string' | 'number' | 'boolean' | 'array' }
  | { type: 'regex'; field: string; pattern: string; flags?: string }
  | { type: 'cross_field'; condition: CrossFieldCondition; requirement: CrossFieldRequirement }
  | { type: 'email'; field: string }
  | { type: 'phone'; field: string }
  | { type: 'min_length'; field: string; minLength: number }
  | { type: 'max_length'; field: string; maxLength: number }
  | { type: 'enum'; field: string; allowedValues: string[] }
  | { type: 'range'; field: string; min?: number; max?: number };

export type CrossFieldCondition = {
  field: string;
  operator: 'eq' | 'neq' | 'exists' | 'not_exists';
  value?: unknown;
};

export type CrossFieldRequirement = {
  field: string;
  operator: 'exists' | 'not_exists' | 'eq' | 'neq';
  value?: unknown;
  message?: string;
};

export type ValidationRule = {
  ruleId: string;
  workspaceId: string;
  entityType: string;
  ruleName: string;
  definition: ValidationRuleDefinition;
  isBlocking: boolean;
  severity: ValidationSeverity;
  createdByUserId: string;
  createdAt: Date;
};

export type ValidationFailure = {
  failureId?: string;
  workspaceId: string;
  entityId: string;
  ruleId: string;
  ruleName: string;
  failureReason: string;
  severity: ValidationSeverity;
  isBlocking: boolean;
  occurredAt: Date;
  acknowledged: boolean;
};

export type ValidationResult = {
  entityId: string;
  valid: boolean;
  blocked: boolean;
  failures: ValidationFailure[];
  warnings: ValidationFailure[];
};

export type ValidationReport = {
  workspaceId: string;
  entityType: string | undefined;
  totalEntities: number;
  validCount: number;
  invalidCount: number;
  warningCount: number;
  failuresByRule: { ruleId: string; ruleName: string; count: number }[];
  generatedAt: Date;
};

// ─── Built-in Rule Validators ─────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

function getFieldValue(entity: SemanticEntity, field: string): unknown {
  if (field === 'label') return entity.label;
  if (field === 'type') return entity.type;
  return (entity.attributes as Record<string, unknown>)[field];
}

function evaluateCondition(entity: SemanticEntity, cond: CrossFieldCondition): boolean {
  const val = getFieldValue(entity, cond.field);
  switch (cond.operator) {
    case 'exists': return val !== undefined && val !== null && val !== '';
    case 'not_exists': return val === undefined || val === null || val === '';
    case 'eq': return val === cond.value;
    case 'neq': return val !== cond.value;
  }
}

function evaluateRequirement(entity: SemanticEntity, req: CrossFieldRequirement): boolean {
  const val = getFieldValue(entity, req.field);
  switch (req.operator) {
    case 'exists': return val !== undefined && val !== null && val !== '';
    case 'not_exists': return val === undefined || val === null || val === '';
    case 'eq': return val === req.value;
    case 'neq': return val !== req.value;
  }
}

/**
 * Evaluate a single rule against an entity.
 * Returns null if rule passes, or a failure reason string if it fails.
 */
function evaluateRule(entity: SemanticEntity, rule: ValidationRule): string | null {
  const def = rule.definition;

  switch (def.type) {
    case 'required': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null || v === '') {
        return `Required field '${def.field}' is missing or empty`;
      }
      return null;
    }

    case 'type': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      const actual = Array.isArray(v) ? 'array' : typeof v;
      if (actual !== def.expectedType) {
        return `Field '${def.field}' expected type '${def.expectedType}' but got '${actual}'`;
      }
      return null;
    }

    case 'regex': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      const pattern = new RegExp(def.pattern, def.flags);
      if (!pattern.test(String(v))) {
        return `Field '${def.field}' does not match required pattern '${def.pattern}'`;
      }
      return null;
    }

    case 'email': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null || v === '') return null;
      if (!EMAIL_RE.test(String(v))) {
        return `Field '${def.field}' is not a valid email address`;
      }
      return null;
    }

    case 'phone': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null || v === '') return null;
      if (!PHONE_RE.test(String(v))) {
        return `Field '${def.field}' is not a valid phone number`;
      }
      return null;
    }

    case 'min_length': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      const s = String(v);
      if (s.length < def.minLength) {
        return `Field '${def.field}' must be at least ${def.minLength} characters (got ${s.length})`;
      }
      return null;
    }

    case 'max_length': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      const s = String(v);
      if (s.length > def.maxLength) {
        return `Field '${def.field}' must be at most ${def.maxLength} characters (got ${s.length})`;
      }
      return null;
    }

    case 'enum': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      if (!def.allowedValues.includes(String(v))) {
        return `Field '${def.field}' value '${v}' is not in allowed values [${def.allowedValues.join(', ')}]`;
      }
      return null;
    }

    case 'range': {
      const v = getFieldValue(entity, def.field);
      if (v === undefined || v === null) return null;
      const n = Number(v);
      if (isNaN(n)) {
        return `Field '${def.field}' must be a number for range validation`;
      }
      if (def.min !== undefined && n < def.min) {
        return `Field '${def.field}' value ${n} is below minimum ${def.min}`;
      }
      if (def.max !== undefined && n > def.max) {
        return `Field '${def.field}' value ${n} exceeds maximum ${def.max}`;
      }
      return null;
    }

    case 'cross_field': {
      const conditionMet = evaluateCondition(entity, def.condition);
      if (!conditionMet) return null;
      const requirementMet = evaluateRequirement(entity, def.requirement);
      if (!requirementMet) {
        return (
          def.requirement.message ??
          `Cross-field rule failed: when '${def.condition.field}' is '${def.condition.operator}' condition, ` +
          `field '${def.requirement.field}' must be '${def.requirement.operator}'`
        );
      }
      return null;
    }
  }
}

// ─── EntityValidationEngine ───────────────────────────────────────────────────

/**
 * Enforces user-defined and built-in data quality rules on semantic entities.
 * Validates at sync time, supports bulk re-validation, and generates failure reports.
 */
export class EntityValidationEngine {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Create or update a validation rule for an entity type.
   *
   * @param rule - Rule definition with workspaceId, entityType, and constraints
   * @returns The stored rule with generated ruleId
   */
  async createRule(
    rule: Omit<ValidationRule, 'ruleId' | 'createdAt'>
  ): Promise<Result<ValidationRule, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO validation_rules
          (workspace_id, entity_type, rule_name, rule_definition, is_blocking, severity, created_by_user_id)
        VALUES
          (${rule.workspaceId}, ${rule.entityType}, ${rule.ruleName},
           ${JSON.stringify(rule.definition)}::jsonb, ${rule.isBlocking},
           ${rule.severity}, ${rule.createdByUserId})
        RETURNING *
      ` as Record<string, unknown>[];

      const r = rows[0]!;
      return ok(this.rowToRule(r));
    } catch (e) {
      log.error('Failed to create validation rule', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all validation rules for a workspace, optionally filtered by entityType.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType - Optional entity type filter
   * @returns Array of validation rules
   */
  async listRules(
    workspaceId: string,
    entityType?: string
  ): Promise<Result<ValidationRule[], Error>> {
    try {
      const rows = entityType
        ? await this.sql`
            SELECT * FROM validation_rules
            WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
            ORDER BY created_at DESC
          ` as Record<string, unknown>[]
        : await this.sql`
            SELECT * FROM validation_rules
            WHERE workspace_id = ${workspaceId}
            ORDER BY created_at DESC
          ` as Record<string, unknown>[];

      return ok(rows.map(r => this.rowToRule(r)));
    } catch (e) {
      log.error('Failed to list validation rules', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a validation rule by ID.
   *
   * @param workspaceId - Tenant workspace (ownership check)
   * @param ruleId - Rule to delete
   */
  async deleteRule(workspaceId: string, ruleId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM validation_rules
        WHERE workspace_id = ${workspaceId} AND rule_id = ${ruleId}
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to delete validation rule', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Validate a single entity against all applicable rules for its type.
   * Does NOT persist failures — use this for testing rules before activation.
   *
   * @param entity - Entity to validate
   * @param workspaceId - Tenant workspace
   * @returns ValidationResult with pass/fail and individual failures
   */
  async validateEntity(
    entity: SemanticEntity,
    workspaceId: string
  ): Promise<Result<ValidationResult, Error>> {
    const rulesResult = await this.listRules(workspaceId, entity.type);
    if (rulesResult.isErr()) return err(rulesResult.error);

    return ok(this.applyRules(entity, rulesResult.value, workspaceId));
  }

  /**
   * Validate a batch of entities and persist failures to the database.
   * Returns entities that passed all blocking rules (safe to index).
   *
   * @param entities - Entities from connector sync
   * @param workspaceId - Tenant workspace
   * @returns Entities that passed validation (blocking rules only)
   */
  async validateBatch(
    entities: SemanticEntity[],
    workspaceId: string
  ): Promise<Result<{ passed: SemanticEntity[]; results: ValidationResult[] }, Error>> {
    if (entities.length === 0) return ok({ passed: [], results: [] });

    const entityTypes = [...new Set(entities.map(e => e.type))];
    const allRules: ValidationRule[] = [];

    for (const et of entityTypes) {
      const r = await this.listRules(workspaceId, et);
      if (r.isErr()) return err(r.error);
      allRules.push(...r.value);
    }

    const rulesByType = new Map<string, ValidationRule[]>();
    for (const rule of allRules) {
      const list = rulesByType.get(rule.entityType) ?? [];
      list.push(rule);
      rulesByType.set(rule.entityType, list);
    }

    const results: ValidationResult[] = [];
    const passed: SemanticEntity[] = [];
    const failuresToPersist: ValidationFailure[] = [];

    for (const entity of entities) {
      const rules = rulesByType.get(entity.type) ?? [];
      const result = this.applyRules(entity, rules, workspaceId);
      results.push(result);

      if (!result.blocked) passed.push(entity);
      failuresToPersist.push(...result.failures, ...result.warnings);
    }

    if (failuresToPersist.length > 0) {
      const persistResult = await this.persistFailures(failuresToPersist);
      if (persistResult.isErr()) {
        log.warn('Failed to persist validation failures', { error: persistResult.error.message });
      }
    }

    log.info('Batch validation complete', {
      workspaceId,
      total: entities.length,
      passed: passed.length,
      blocked: entities.length - passed.length,
      failures: failuresToPersist.length,
    });

    return ok({ passed, results });
  }

  /**
   * Bulk re-validate already-indexed entities on-demand.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType - Optional filter; if omitted, all types are validated
   * @param limit - Max entities to process (default 1000)
   * @returns Summary of validation run
   */
  async bulkRevalidate(
    workspaceId: string,
    entityType?: string,
    limit = 1000
  ): Promise<Result<{ processed: number; blocked: number; warnings: number }, Error>> {
    try {
      const rows = entityType
        ? await this.sql`
            SELECT id, type, label, attributes, relationships, last_modified, source_id
            FROM indexed_entities
            WHERE workspace_id = ${workspaceId} AND type = ${entityType}
            LIMIT ${limit}
          ` as Record<string, unknown>[]
        : await this.sql`
            SELECT id, type, label, attributes, relationships, last_modified, source_id
            FROM indexed_entities
            WHERE workspace_id = ${workspaceId}
            LIMIT ${limit}
          ` as Record<string, unknown>[];

      const entities: SemanticEntity[] = rows.map(r => ({
        id: String(r['id']),
        type: String(r['type']),
        label: String(r['label']),
        attributes: (r['attributes'] as Record<string, AttributeValue>) ?? {},
        relationships: (r['relationships'] as SemanticEntity['relationships']) ?? [],
        lastModified: r['last_modified'] ? new Date(r['last_modified'] as string) : new Date(),
        sourceId: String(r['source_id'] ?? r['id']),
      }));

      const batchResult = await this.validateBatch(entities, workspaceId);
      if (batchResult.isErr()) return err(batchResult.error);

      const { results } = batchResult.value;
      const blocked = results.filter(r => r.blocked).length;
      const warnings = results.reduce((acc, r) => acc + r.warnings.length, 0);

      return ok({ processed: entities.length, blocked, warnings });
    } catch (e) {
      log.error('Bulk re-validation failed', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve paginated validation failures for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param options - Pagination and filtering options
   * @returns Failures with pagination cursor
   */
  async listFailures(
    workspaceId: string,
    options: {
      entityType?: string;
      ruleId?: string;
      acknowledged?: boolean;
      cursor?: string;
      limit?: number;
    } = {}
  ): Promise<Result<{ failures: ValidationFailure[]; nextCursor: string | null; hasMore: boolean }, Error>> {
    const limit = Math.min(options.limit ?? 50, 200);
    try {
      const rows = await this.sql`
        SELECT vf.*, vr.rule_name, vr.severity, vr.is_blocking, vr.entity_type
        FROM validation_failures vf
        JOIN validation_rules vr ON vf.rule_id = vr.rule_id
        WHERE vf.workspace_id = ${workspaceId}
          AND (${options.acknowledged ?? null}::boolean IS NULL OR vf.acknowledged = ${options.acknowledged ?? null}::boolean)
          AND (${options.ruleId ?? null}::uuid IS NULL OR vf.rule_id = ${options.ruleId ?? null}::uuid)
          AND (${options.cursor ?? null}::uuid IS NULL OR vf.failure_id > ${options.cursor ?? null}::uuid)
        ORDER BY vf.failure_id ASC
        LIMIT ${limit + 1}
      ` as Record<string, unknown>[];

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const nextCursor = hasMore ? String(page[page.length - 1]?.['failure_id']) : null;

      return ok({
        failures: page.map(r => this.rowToFailure(r)),
        nextCursor,
        hasMore,
      });
    } catch (e) {
      log.error('Failed to list validation failures', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Acknowledge a validation failure (mark as reviewed).
   *
   * @param workspaceId - Tenant workspace
   * @param failureId - Failure to acknowledge
   */
  async acknowledgeFailure(workspaceId: string, failureId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE validation_failures
        SET acknowledged = true, acknowledged_at = now()
        WHERE workspace_id = ${workspaceId} AND failure_id = ${failureId}
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to acknowledge failure', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate a validation report summarizing rule failures by entity type.
   *
   * @param workspaceId - Tenant workspace
   * @param entityType - Optional filter
   * @returns Aggregated ValidationReport
   */
  async generateReport(
    workspaceId: string,
    entityType?: string
  ): Promise<Result<ValidationReport, Error>> {
    try {
      const [totalRow, failureRows] = await Promise.all([
        entityType
          ? this.sql`
              SELECT COUNT(*)::int AS total
              FROM indexed_entities
              WHERE workspace_id = ${workspaceId} AND type = ${entityType}
            ` as Promise<Record<string, unknown>[]>
          : this.sql`
              SELECT COUNT(*)::int AS total
              FROM indexed_entities
              WHERE workspace_id = ${workspaceId}
            ` as Promise<Record<string, unknown>[]>,
        this.sql`
          SELECT
            vf.rule_id,
            vr.rule_name,
            vr.severity,
            COUNT(*)::int AS count
          FROM validation_failures vf
          JOIN validation_rules vr ON vf.rule_id = vr.rule_id
          WHERE vf.workspace_id = ${workspaceId}
            AND vf.acknowledged = false
          GROUP BY vf.rule_id, vr.rule_name, vr.severity
          ORDER BY count DESC
        ` as Promise<Record<string, unknown>[]>,
      ]);

      const totalEntities = (totalRow[0]?.['total'] as number) ?? 0;
      const totalFailures = (failureRows as Record<string, unknown>[])
        .filter(r => r['severity'] === 'error')
        .reduce((s, r) => s + (r['count'] as number), 0);
      const totalWarnings = (failureRows as Record<string, unknown>[])
        .filter(r => r['severity'] === 'warning')
        .reduce((s, r) => s + (r['count'] as number), 0);

      return ok({
        workspaceId,
        entityType,
        totalEntities,
        validCount: Math.max(0, totalEntities - totalFailures),
        invalidCount: totalFailures,
        warningCount: totalWarnings,
        failuresByRule: (failureRows as Record<string, unknown>[]).map(r => ({
          ruleId: String(r['rule_id']),
          ruleName: String(r['rule_name']),
          count: r['count'] as number,
        })),
        generatedAt: new Date(),
      });
    } catch (e) {
      log.error('Failed to generate validation report', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private applyRules(
    entity: SemanticEntity,
    rules: ValidationRule[],
    workspaceId: string
  ): ValidationResult {
    const failures: ValidationFailure[] = [];
    const warnings: ValidationFailure[] = [];
    const now = new Date();

    for (const rule of rules) {
      const reason = evaluateRule(entity, rule);
      if (reason === null) continue;

      const failure: ValidationFailure = {
        workspaceId,
        entityId: entity.id,
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        failureReason: reason,
        severity: rule.severity,
        isBlocking: rule.isBlocking,
        occurredAt: now,
        acknowledged: false,
      };

      if (rule.severity === 'error') {
        failures.push(failure);
      } else {
        warnings.push(failure);
      }
    }

    const blocked = failures.some(f => f.isBlocking);

    return {
      entityId: entity.id,
      valid: failures.length === 0,
      blocked,
      failures,
      warnings,
    };
  }

  private async persistFailures(failures: ValidationFailure[]): Promise<Result<void, Error>> {
    try {
      for (const f of failures) {
        await this.sql`
          INSERT INTO validation_failures
            (workspace_id, entity_id, rule_id, failure_reason, occurred_at, acknowledged)
          VALUES
            (${f.workspaceId}, ${f.entityId}, ${f.ruleId}, ${f.failureReason}, ${f.occurredAt}, false)
          ON CONFLICT (workspace_id, entity_id, rule_id)
          DO UPDATE SET
            failure_reason = EXCLUDED.failure_reason,
            occurred_at = EXCLUDED.occurred_at,
            acknowledged = false
        `;
      }
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private rowToRule(r: Record<string, unknown>): ValidationRule {
    return {
      ruleId: String(r['rule_id']),
      workspaceId: String(r['workspace_id']),
      entityType: String(r['entity_type']),
      ruleName: String(r['rule_name']),
      definition: r['rule_definition'] as ValidationRuleDefinition,
      isBlocking: Boolean(r['is_blocking']),
      severity: (r['severity'] as ValidationSeverity) ?? 'error',
      createdByUserId: String(r['created_by_user_id']),
      createdAt: new Date(r['created_at'] as string),
    };
  }

  private rowToFailure(r: Record<string, unknown>): ValidationFailure {
    return {
      failureId: String(r['failure_id']),
      workspaceId: String(r['workspace_id']),
      entityId: String(r['entity_id']),
      ruleId: String(r['rule_id']),
      ruleName: String(r['rule_name']),
      failureReason: String(r['failure_reason']),
      severity: (r['severity'] as ValidationSeverity) ?? 'error',
      isBlocking: Boolean(r['is_blocking']),
      occurredAt: new Date(r['occurred_at'] as string),
      acknowledged: Boolean(r['acknowledged']),
    };
  }
}
