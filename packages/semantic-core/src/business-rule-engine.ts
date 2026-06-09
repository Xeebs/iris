import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'business-rule-engine' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RuleSeverity = 'error' | 'warning' | 'info';

export type RuleAction = 'reject' | 'warn' | 'log';

export type ConditionOperator = 'required' | 'not_empty' | 'matches' | 'min_length' | 'max_length' | 'one_of';

export type RuleCondition = {
  field: string;
  operator: ConditionOperator;
  value?: string | string[] | number;
};

export type BusinessRule = {
  id: string;
  name: string;
  entityType: string;
  conditions: RuleCondition[];
  action: RuleAction;
  severity: RuleSeverity;
  description: string;
  active: boolean;
  createdAt: Date;
};

export type RuleViolation = {
  ruleId: string;
  entityId: string;
  entityType: string;
  violatedCondition: RuleCondition;
  correctionSuggestion: string | null;
  severity: RuleSeverity;
  detectedAt: Date;
};

export type AutoCorrectResult = {
  entityId: string;
  ruleId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  applied: boolean;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single condition against an entity's attribute value.
 * @param condition - Rule condition to evaluate
 * @param value - Actual attribute value
 * @returns true if the condition passes (entity is valid)
 */
export function evaluateCondition(condition: RuleCondition, value: unknown): boolean {
  switch (condition.operator) {
    case 'required':
      return value !== null && value !== undefined && value !== '';
    case 'not_empty':
      return value !== null && value !== undefined && String(value).trim() !== '';
    case 'matches':
      return typeof value === 'string' && new RegExp(String(condition.value)).test(value);
    case 'min_length':
      return typeof value === 'string' && value.length >= Number(condition.value);
    case 'max_length':
      return typeof value === 'string' && value.length <= Number(condition.value);
    case 'one_of':
      return Array.isArray(condition.value) && condition.value.includes(String(value));
    default:
      return true;
  }
}

/**
 * Generate a correction suggestion for a violated condition.
 * @param condition - The condition that was violated
 * @param currentValue - The current (invalid) value
 * @returns Human-readable correction suggestion, or null if no suggestion available
 */
export function generateCorrectionSuggestion(condition: RuleCondition, currentValue: unknown): string | null {
  switch (condition.operator) {
    case 'required':
    case 'not_empty':
      return `Provide a value for field "${condition.field}"`;
    case 'min_length':
      return `Field "${condition.field}" must be at least ${condition.value} characters (currently ${String(currentValue ?? '').length})`;
    case 'max_length':
      return `Trim field "${condition.field}" to at most ${condition.value} characters (currently ${String(currentValue ?? '').length})`;
    case 'matches':
      return `Field "${condition.field}" must match pattern: ${condition.value}`;
    case 'one_of':
      return `Field "${condition.field}" must be one of: ${Array.isArray(condition.value) ? condition.value.join(', ') : condition.value}`;
    default:
      return null;
  }
}

/**
 * Apply a low-risk auto-correction to a field value.
 * Only handles safe, deterministic transformations (trim, lowercase normalization).
 * @param condition - The violated condition
 * @param field - Field name
 * @param currentValue - Current value to correct
 * @param trustLevel - 'safe' = only trim/case; 'aggressive' = also fill defaults
 * @returns Corrected value, or null if no safe correction possible
 */
export function computeAutoCorrection(
  condition: RuleCondition,
  currentValue: unknown,
  trustLevel: 'safe' | 'aggressive',
): unknown | null {
  if (condition.operator === 'not_empty' && typeof currentValue === 'string') {
    const trimmed = currentValue.trim();
    return trimmed !== currentValue ? trimmed : null;
  }
  if (condition.operator === 'max_length' && typeof currentValue === 'string' && typeof condition.value === 'number') {
    return currentValue.length > condition.value ? currentValue.slice(0, condition.value) : null;
  }
  if (condition.operator === 'required' && trustLevel === 'aggressive') {
    return 'UNKNOWN';
  }
  return null;
}

/**
 * Count violations by severity from a list of violations.
 */
export function countViolationsBySeverity(violations: RuleViolation[]): Record<RuleSeverity, number> {
  return violations.reduce<Record<RuleSeverity, number>>(
    (acc, v) => { acc[v.severity] = (acc[v.severity] ?? 0) + 1; return acc; },
    { error: 0, warning: 0, info: 0 },
  );
}

// ─── RuleEngine ───────────────────────────────────────────────────────────────

export class RuleEngine {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Define and persist a new business rule.
   */
  async defineRule(
    name: string,
    entityType: string,
    conditions: RuleCondition[],
    action: RuleAction,
    severity: RuleSeverity,
    description = '',
  ): Promise<Result<BusinessRule, Error>> {
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO business_rules (id, name, entity_type, conditions, action, severity, description, active)
        VALUES (${id}, ${name}, ${entityType}, ${JSON.stringify(conditions)}, ${action}, ${severity}, ${description}, true)
      `;
      log.info('Rule defined', { id, name, entityType });
      return ok({ id, name, entityType, conditions, action, severity, description, active: true, createdAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Evaluate all active rules for an entity.
   * @param entity - Entity object with id, type, and attributes
   * @returns List of violations detected
   */
  async evaluateEntity(
    entity: { id: string; type: string; attributes: Record<string, unknown> },
  ): Promise<Result<RuleViolation[], Error>> {
    try {
      type Row = { id: string; name: string; conditions: unknown; action: string; severity: string };
      const rules = await this.sql<Row[]>`
        SELECT id, name, conditions, action, severity
        FROM business_rules
        WHERE entity_type = ${entity.type} AND active = true
      `;
      const violations: RuleViolation[] = [];
      for (const rule of rules) {
        const conditions: RuleCondition[] = Array.isArray(rule.conditions)
          ? (rule.conditions as RuleCondition[])
          : JSON.parse(rule.conditions as unknown as string);
        for (const condition of conditions) {
          const value = entity.attributes[condition.field];
          if (!evaluateCondition(condition, value)) {
            violations.push({
              ruleId: rule.id,
              entityId: entity.id,
              entityType: entity.type,
              violatedCondition: condition,
              correctionSuggestion: generateCorrectionSuggestion(condition, value),
              severity: rule.severity as RuleSeverity,
              detectedAt: new Date(),
            });
          }
        }
      }
      return ok(violations);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Batch-evaluate rules for multiple entities.
   * @param entities - Array of entities to validate
   * @param ruleIds - Optional subset of rule IDs to evaluate (all active rules if omitted)
   */
  async bulkEvaluateRules(
    entities: { id: string; type: string; attributes: Record<string, unknown> }[],
  ): Promise<Result<{ entityId: string; violations: RuleViolation[] }[], Error>> {
    try {
      const results = await Promise.all(entities.map(async (entity) => {
        const result = await this.evaluateEntity(entity);
        return { entityId: entity.id, violations: result.isOk() ? result.value : [] };
      }));
      return ok(results);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Attempt to auto-correct violations for a list of entities.
   * @param entityIds - Entity IDs to attempt correction on
   * @param trustLevel - How aggressive the corrections should be
   */
  async autoCorrectViolations(
    entityIds: string[],
    trustLevel: 'safe' | 'aggressive' = 'safe',
  ): Promise<Result<AutoCorrectResult[], Error>> {
    try {
      const corrections: AutoCorrectResult[] = [];
      for (const entityId of entityIds) {
        type Row = { attributes: unknown };
        const [row] = await this.sql<Row[]>`SELECT attributes FROM iris_entities WHERE id = ${entityId}`;
        if (!row) continue;
        const attrs = typeof row.attributes === 'object' && row.attributes !== null ? row.attributes as Record<string, unknown> : {};
        type RuleRow = { id: string; conditions: unknown };
        const rules = await this.sql<RuleRow[]>`SELECT id, conditions FROM business_rules WHERE active = true`;
        for (const rule of rules) {
          const conditions: RuleCondition[] = Array.isArray(rule.conditions)
            ? (rule.conditions as RuleCondition[])
            : JSON.parse(rule.conditions as unknown as string);
          for (const condition of conditions) {
            const current = attrs[condition.field];
            if (!evaluateCondition(condition, current)) {
              const correction = computeAutoCorrection(condition, current, trustLevel);
              if (correction !== null) {
                corrections.push({ entityId, ruleId: rule.id, field: condition.field, oldValue: current, newValue: correction, applied: true });
              } else {
                corrections.push({ entityId, ruleId: rule.id, field: condition.field, oldValue: current, newValue: null, applied: false });
              }
            }
          }
        }
      }
      return ok(corrections);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get violation statistics within a time window.
   */
  async trackRuleViolations(
    window: '1d' | '7d' | '30d' = '7d',
  ): Promise<Result<{ ruleId: string; ruleName: string; violationCount: number; severity: RuleSeverity }[], Error>> {
    const days = window === '1d' ? 1 : window === '7d' ? 7 : 30;
    try {
      type Row = { rule_id: string; rule_name: string; violation_count: number; severity: string };
      const rows = await this.sql<Row[]>`
        SELECT rv.rule_id,
               br.name AS rule_name,
               COUNT(*)::int AS violation_count,
               br.severity
        FROM rule_violations rv
        JOIN business_rules br ON br.id = rv.rule_id
        WHERE rv.detected_at >= NOW() - (${days} || ' days')::interval
        GROUP BY rv.rule_id, br.name, br.severity
        ORDER BY violation_count DESC
      `;
      return ok(rows.map((r) => ({
        ruleId: r.rule_id, ruleName: r.rule_name,
        violationCount: r.violation_count, severity: r.severity as RuleSeverity,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all business rules.
   */
  async listRules(entityType?: string): Promise<Result<BusinessRule[], Error>> {
    try {
      type Row = { id: string; name: string; entity_type: string; conditions: unknown; action: string; severity: string; description: string; active: boolean; created_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, name, entity_type, conditions, action, severity, description, active, created_at
        FROM business_rules
        WHERE (${entityType ? this.sql`entity_type = ${entityType}` : this.sql`TRUE`})
        ORDER BY created_at DESC
      `;
      return ok(rows.map((r) => ({
        id: r.id, name: r.name, entityType: r.entity_type,
        conditions: Array.isArray(r.conditions) ? (r.conditions as RuleCondition[]) : JSON.parse(r.conditions as unknown as string),
        action: r.action as RuleAction, severity: r.severity as RuleSeverity,
        description: r.description, active: r.active, createdAt: r.created_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
