import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'metric-formula' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type AggregateFunction = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
export type BinaryOperator = '+' | '-' | '*' | '/';

export interface AggregateTerm {
  fn: AggregateFunction;
  entityType: string;
  field: string | null;
}

export interface ParsedFormula {
  raw: string;
  left: AggregateTerm;
  operator: BinaryOperator | null;
  right: AggregateTerm | null;
}

export interface FormulaValidationError {
  message: string;
  position?: number;
}

export interface EvaluationResult {
  metricId: string;
  workspaceId: string;
  value: number;
  formula: string;
  evaluatedAt: string;
  fromCache: boolean;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Parser ───────────────────────────────────────────────────────────────────

const AGG_PATTERN = /^(SUM|COUNT|AVG|MIN|MAX)\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\)$/i;
const FORMULA_PATTERN =
  /^(SUM|COUNT|AVG|MIN|MAX)\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\)(?:\s*([+\-*/])\s*(SUM|COUNT|AVG|MIN|MAX)\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\))?$/i;

function parseTerm(raw: string): AggregateTerm | null {
  const m = AGG_PATTERN.exec(raw.trim());
  if (!m) return null;
  const fn = m[1]!.toUpperCase() as AggregateFunction;
  const ref = m[2]!;
  const dotIdx = ref.indexOf('.');
  if (dotIdx >= 0) {
    return { fn, entityType: ref.slice(0, dotIdx), field: ref.slice(dotIdx + 1) };
  }
  return { fn, entityType: ref, field: null };
}

/**
 * Parse a metric formula string into a structured representation.
 * Supports single aggregates (SUM, COUNT, AVG, MIN, MAX) and ratios of two aggregates.
 *
 * @param formula - Formula string, e.g. "SUM(deal.amount) / COUNT(deal)"
 * @returns Parsed formula or validation errors
 */
export function parseFormula(formula: string): Result<ParsedFormula, FormulaValidationError[]> {
  const trimmed = formula.trim();
  const errors: FormulaValidationError[] = [];

  if (!trimmed) {
    return err([{ message: 'Formula must not be empty' }]);
  }

  const m = FORMULA_PATTERN.exec(trimmed);
  if (!m) {
    return err([{ message: `Invalid formula syntax: "${trimmed}". Expected: AGG(entity[.field]) [OP AGG(entity[.field])]` }]);
  }

  const leftRaw = `${m[1]!}(${m[2]!})`;
  const leftTerm = parseTerm(leftRaw);
  if (!leftTerm) {
    errors.push({ message: `Could not parse left term: "${leftRaw}"` });
  }

  let rightTerm: AggregateTerm | null = null;
  let operator: BinaryOperator | null = null;

  if (m[3]) {
    operator = m[3] as BinaryOperator;
    const rightRaw = `${m[4]!}(${m[5]!})`;
    rightTerm = parseTerm(rightRaw);
    if (!rightTerm) {
      errors.push({ message: `Could not parse right term: "${rightRaw}"` });
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({ raw: trimmed, left: leftTerm!, operator, right: rightTerm });
}

/**
 * Validate a formula string and return human-readable errors.
 *
 * @param formula - Formula to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateFormula(formula: string): FormulaValidationError[] {
  const result = parseFormula(formula);
  return result.isErr() ? result.error : [];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

const RESULT_CACHE = new Map<string, { value: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Evaluates metric formulas against the indexed entity store.
 * Formulas are parsed, converted to SQL aggregations, and cached per
 * workspace+formula for CACHE_TTL_MS milliseconds.
 */
export class MetricFormulaEngine {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Evaluate a formula for a workspace. Results are cached for 5 minutes.
   *
   * @param metricId   - Metric identifier (used for cache key)
   * @param workspaceId - Target workspace
   * @param formula    - Formula string to evaluate
   */
  async evaluate(
    metricId: string,
    workspaceId: string,
    formula: string,
  ): Promise<Result<EvaluationResult, Error>> {
    const cacheKey = `${workspaceId}:${metricId}`;
    const cached = RESULT_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return ok({
        metricId, workspaceId, value: cached.value, formula,
        evaluatedAt: new Date().toISOString(), fromCache: true,
      });
    }

    const parseResult = parseFormula(formula);
    if (parseResult.isErr()) {
      return err(new Error(parseResult.error.map(e => e.message).join('; ')));
    }

    const parsed = parseResult.value;

    try {
      const value = await this.computeFormula(parsed, workspaceId);

      RESULT_CACHE.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });

      log.info('Metric evaluated', { metricId, workspaceId, value, formula });
      return ok({
        metricId, workspaceId, value, formula,
        evaluatedAt: new Date().toISOString(), fromCache: false,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Invalidate cached result for a metric.
   *
   * @param metricId    - Metric to invalidate
   * @param workspaceId - Target workspace
   */
  invalidateCache(metricId: string, workspaceId: string): void {
    RESULT_CACHE.delete(`${workspaceId}:${metricId}`);
  }

  private async computeFormula(parsed: ParsedFormula, workspaceId: string): Promise<number> {
    const leftVal = await this.computeTerm(parsed.left, workspaceId);

    if (!parsed.operator || !parsed.right) {
      return leftVal;
    }

    const rightVal = await this.computeTerm(parsed.right, workspaceId);

    switch (parsed.operator) {
      case '+': return leftVal + rightVal;
      case '-': return leftVal - rightVal;
      case '*': return leftVal * rightVal;
      case '/':
        if (rightVal === 0) return 0;
        return leftVal / rightVal;
    }
  }

  private async computeTerm(term: AggregateTerm, workspaceId: string): Promise<number> {
    const { fn, entityType, field } = term;

    type Row = { result: string | null };
    let rows: Row[];

    if (fn === 'COUNT') {
      rows = await this.sql`
        SELECT COUNT(*)::TEXT AS result
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
      ` as Row[];
    } else if (fn === 'SUM') {
      rows = await this.sql`
        SELECT COALESCE(SUM(CAST(attributes->>${field ?? 'id'} AS NUMERIC)), 0)::TEXT AS result
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
      ` as Row[];
    } else if (fn === 'AVG') {
      rows = await this.sql`
        SELECT COALESCE(AVG(CAST(attributes->>${field ?? 'id'} AS NUMERIC)), 0)::TEXT AS result
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
      ` as Row[];
    } else if (fn === 'MIN') {
      rows = await this.sql`
        SELECT COALESCE(MIN(CAST(attributes->>${field ?? 'id'} AS NUMERIC)), 0)::TEXT AS result
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
      ` as Row[];
    } else {
      rows = await this.sql`
        SELECT COALESCE(MAX(CAST(attributes->>${field ?? 'id'} AS NUMERIC)), 0)::TEXT AS result
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
      ` as Row[];
    }

    return parseFloat(rows[0]?.result ?? '0') || 0;
  }
}
