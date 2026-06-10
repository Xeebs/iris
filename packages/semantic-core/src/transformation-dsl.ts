import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';
import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';

const log = logger.child({ service: 'transformation-dsl' });

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — required for jsonb columns (plain strings are stored as jsonb string scalars) */
  json(value: unknown): unknown;
};

// ─── Transformation Rule Types ────────────────────────────────────────────────

export type TransformationStep =
  | { op: 'rename'; from: string; to: string }
  | { op: 'remove'; field: string }
  | { op: 'keep_only'; fields: string[] }
  | { op: 'normalize_case'; field: string; mode: 'upper' | 'lower' | 'title' }
  | { op: 'trim'; field: string }
  | { op: 'regex_replace'; field: string; pattern: string; replacement: string; flags?: string }
  | { op: 'concat'; fields: string[]; separator: string; targetField: string }
  | { op: 'extract_substring'; field: string; start: number; end?: number; targetField?: string }
  | { op: 'format_date'; field: string; format: 'iso' | 'short' | 'epoch_ms' }
  | { op: 'set_default'; field: string; defaultValue: AttributeValue }
  | { op: 'map_value'; field: string; mapping: Record<string, AttributeValue>; fallback?: AttributeValue };

export type TransformationRule = {
  ruleId: string;
  workspaceId: string;
  connectorId: string | undefined;
  entityType: string | undefined;
  ruleName: string;
  steps: TransformationStep[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TransformationTestResult = {
  input: SemanticEntity;
  output: SemanticEntity;
  stepsApplied: number;
  transformedFields: string[];
};

// ─── Step execution ───────────────────────────────────────────────────────────

function applyStep(
  attrs: Record<string, AttributeValue>,
  step: TransformationStep
): { attrs: Record<string, AttributeValue>; changed: string[] } {
  const changed: string[] = [];
  const out = { ...attrs };

  switch (step.op) {
    case 'rename': {
      if (step.from in out) {
        out[step.to] = out[step.from]!;
        delete out[step.from];
        changed.push(step.from, step.to);
      }
      break;
    }

    case 'remove': {
      if (step.field in out) {
        delete out[step.field];
        changed.push(step.field);
      }
      break;
    }

    case 'keep_only': {
      const keep = new Set(step.fields);
      for (const k of Object.keys(out)) {
        if (!keep.has(k)) {
          delete out[k];
          changed.push(k);
        }
      }
      break;
    }

    case 'normalize_case': {
      const v = out[step.field];
      if (typeof v === 'string') {
        out[step.field] =
          step.mode === 'upper'
            ? v.toUpperCase()
            : step.mode === 'lower'
              ? v.toLowerCase()
              : v.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        changed.push(step.field);
      }
      break;
    }

    case 'trim': {
      const v = out[step.field];
      if (typeof v === 'string') {
        out[step.field] = v.trim();
        changed.push(step.field);
      }
      break;
    }

    case 'regex_replace': {
      const v = out[step.field];
      if (typeof v === 'string') {
        const re = new RegExp(step.pattern, step.flags ?? 'g');
        out[step.field] = v.replace(re, step.replacement);
        changed.push(step.field);
      }
      break;
    }

    case 'concat': {
      const parts = step.fields
        .map(f => (out[f] !== undefined && out[f] !== null ? String(out[f]) : ''))
        .filter(Boolean);
      out[step.targetField] = parts.join(step.separator);
      changed.push(step.targetField);
      break;
    }

    case 'extract_substring': {
      const v = out[step.field];
      if (typeof v === 'string') {
        const substr = step.end !== undefined ? v.slice(step.start, step.end) : v.slice(step.start);
        const target = step.targetField ?? step.field;
        out[target] = substr;
        changed.push(target);
      }
      break;
    }

    case 'format_date': {
      const v = out[step.field];
      if (v !== undefined && v !== null) {
        const d = new Date(String(v));
        if (!isNaN(d.getTime())) {
          out[step.field] =
            step.format === 'iso'
              ? d.toISOString()
              : step.format === 'short'
                ? d.toLocaleDateString('en-US')
                : String(d.getTime());
          changed.push(step.field);
        }
      }
      break;
    }

    case 'set_default': {
      if (out[step.field] === undefined || out[step.field] === null || out[step.field] === '') {
        out[step.field] = step.defaultValue;
        changed.push(step.field);
      }
      break;
    }

    case 'map_value': {
      const v = out[step.field];
      if (v !== undefined && v !== null) {
        const key = String(v);
        if (key in step.mapping) {
          out[step.field] = step.mapping[key]!;
          changed.push(step.field);
        } else if (step.fallback !== undefined) {
          out[step.field] = step.fallback;
          changed.push(step.field);
        }
      }
      break;
    }
  }

  return { attrs: out, changed };
}

// ─── TransformationDSLEngine ─────────────────────────────────────────────────

/**
 * Applies user-defined chainable transformation rules to entities at sync time.
 * Rules are stored in the DB and applied in creation order.
 */
export class TransformationDSLEngine {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Create a new transformation rule chain for an entity type.
   *
   * @param rule - Rule definition with steps array
   * @returns The stored rule with generated ruleId
   */
  async createRule(
    rule: Omit<TransformationRule, 'ruleId' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<TransformationRule, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO transformation_rules
          (workspace_id, connector_id, entity_type, rule_name, steps, is_active)
        VALUES
          (${rule.workspaceId}, ${rule.connectorId ?? null}, ${rule.entityType ?? null},
           ${rule.ruleName}, ${this.sql.json(rule.steps)}, ${rule.isActive})
        RETURNING *
      ` as Record<string, unknown>[];

      return ok(this.rowToRule(rows[0]!));
    } catch (e) {
      log.error('Failed to create transformation rule', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List transformation rules for a workspace, optionally filtering by connector/entity type.
   *
   * @param workspaceId - Tenant workspace
   * @param connectorId - Optional connector filter
   * @param entityType - Optional entity type filter
   * @returns Array of matching transformation rules
   */
  async listRules(
    workspaceId: string,
    connectorId?: string,
    entityType?: string
  ): Promise<Result<TransformationRule[], Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM transformation_rules
        WHERE workspace_id = ${workspaceId}
          AND (${connectorId ?? null}::text IS NULL OR connector_id = ${connectorId ?? null})
          AND (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
          AND is_active = true
        ORDER BY created_at ASC
      ` as Record<string, unknown>[];

      return ok(rows.map(r => this.rowToRule(r)));
    } catch (e) {
      log.error('Failed to list transformation rules', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a transformation rule.
   *
   * @param workspaceId - Tenant workspace (ownership check)
   * @param ruleId - Rule to delete
   */
  async deleteRule(workspaceId: string, ruleId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM transformation_rules
        WHERE workspace_id = ${workspaceId} AND rule_id = ${ruleId}
      `;
      return ok(undefined);
    } catch (e) {
      log.error('Failed to delete transformation rule', { error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Apply a specific rule chain to a sample entity (without persisting).
   * Used by the UI test panel to preview transformations before activation.
   *
   * @param entity - Sample entity to transform
   * @param steps - Transformation steps to apply
   * @returns Test result with input, output, and change summary
   */
  testTransformation(
    entity: SemanticEntity,
    steps: TransformationStep[]
  ): TransformationTestResult {
    let attrs = { ...(entity.attributes as Record<string, AttributeValue>) };
    const allChanged = new Set<string>();

    for (const step of steps) {
      const { attrs: newAttrs, changed } = applyStep(attrs, step);
      attrs = newAttrs;
      for (const c of changed) allChanged.add(c);
    }

    const output: SemanticEntity = {
      ...entity,
      attributes: attrs,
    };

    return {
      input: entity,
      output,
      stepsApplied: steps.length,
      transformedFields: [...allChanged],
    };
  }

  /**
   * Apply all active transformation rules for the given connector + entity type
   * to a batch of entities. Called at sync time before indexing.
   *
   * @param entities - Entities to transform
   * @param workspaceId - Tenant workspace
   * @param connectorId - Source connector ID
   * @returns Transformed entity batch
   */
  async applyToEntities(
    entities: SemanticEntity[],
    workspaceId: string,
    connectorId: string
  ): Promise<Result<SemanticEntity[], Error>> {
    if (entities.length === 0) return ok([]);

    const entityTypes = [...new Set(entities.map(e => e.type))];
    const rulesByType = new Map<string, TransformationRule[]>();

    for (const et of entityTypes) {
      const r = await this.listRules(workspaceId, connectorId, et);
      if (r.isErr()) return err(r.error);
      if (r.value.length > 0) rulesByType.set(et, r.value);
    }

    const transformed: SemanticEntity[] = entities.map(entity => {
      const rules = rulesByType.get(entity.type) ?? [];
      if (rules.length === 0) return entity;

      const allSteps = rules.flatMap(r => r.steps);
      const { output } = this.testTransformation(entity, allSteps);
      return output;
    });

    log.info('Transformations applied', {
      workspaceId,
      connectorId,
      entityCount: entities.length,
      rulesApplied: [...rulesByType.values()].flat().length,
    });

    return ok(transformed);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private rowToRule(r: Record<string, unknown>): TransformationRule {
    return {
      ruleId: String(r['rule_id']),
      workspaceId: String(r['workspace_id']),
      connectorId: r['connector_id'] ? String(r['connector_id']) : undefined,
      entityType: r['entity_type'] ? String(r['entity_type']) : undefined,
      ruleName: String(r['rule_name']),
      steps: r['steps'] as TransformationStep[],
      isActive: Boolean(r['is_active']),
      createdAt: new Date(r['created_at'] as string),
      updatedAt: new Date(r['updated_at'] as string),
    };
  }
}
