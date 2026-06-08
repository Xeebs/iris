import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'metrics' });

export interface Metric {
  id: string;
  workspaceId: string;
  name: string;
  formula: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const metricRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  formula: z.string(),
  description: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

type SqlClient = ReturnType<typeof postgres>;

function toMetric(row: z.infer<typeof metricRow>): Metric {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    formula: row.formula,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Formula Engine ───────────────────────────────────────────────────────────

export type FormulaFunction = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
export type FormulaToken =
  | { kind: 'call'; fn: FormulaFunction; field: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' };

export type ParsedFormula = {
  tokens: FormulaToken[];
  raw: string;
};

export type FormulaEvalResult = {
  value: number | null;
  formula: string;
  evaluatedAt: string;
};

const FORMULA_REGEX = /(\d+(?:\.\d+)?)|([A-Z]+)\(([^)]+)\)|([\+\-\*\/])/g;

/**
 * Parses and evaluates custom metric formulas against indexed entity data.
 * Supports SUM/COUNT/AVG/MIN/MAX over indexed_entities attribute fields.
 */
export class MetricFormulaEngine {
  private readonly cache = new Map<string, { value: number; expiresAt: number }>();

  constructor(private readonly sql: SqlClient) {}

  /**
   * Parse a formula string into tokens.
   * Supports: SUM(field), COUNT(field), AVG(field), MIN(field), MAX(field), +, -, *, /, numbers.
   *
   * @param formula - e.g. "SUM(revenue) / COUNT(customers)"
   * @returns Parsed formula tokens
   */
  parseFormula(formula: string): Result<ParsedFormula, Error> {
    const tokens: FormulaToken[] = [];
    const regex = new RegExp(FORMULA_REGEX.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(formula.trim())) !== null) {
      const [, num, fn, field, op] = match;
      if (num) {
        tokens.push({ kind: 'number', value: parseFloat(num) });
      } else if (fn && field) {
        const upperFn = fn.toUpperCase() as FormulaFunction;
        if (!['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'].includes(upperFn)) {
          return err(new Error(`Unknown function: ${fn}`));
        }
        tokens.push({ kind: 'call', fn: upperFn, field: field.trim() });
      } else if (op) {
        tokens.push({ kind: 'op', op: op as FormulaToken extends { kind: 'op' } ? FormulaToken['op'] : never });
      }
    }
    if (tokens.length === 0) return err(new Error('Empty or unparseable formula'));
    return ok({ tokens, raw: formula });
  }

  /**
   * Evaluate a formula for a workspace, running the aggregations against indexed entity data.
   * Results are cached for 60 seconds.
   *
   * @param workspaceId - Workspace scope
   * @param formula - Formula string
   * @returns Numeric result or null if no data
   */
  async evaluateFormula(workspaceId: string, formula: string): Promise<Result<FormulaEvalResult, Error>> {
    const cacheKey = `${workspaceId}:${formula}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return ok({ value: cached.value, formula, evaluatedAt: new Date().toISOString() });
    }

    const parsed = this.parseFormula(formula);
    if (parsed.isErr()) return err(parsed.error);

    try {
      const values: number[] = [];
      for (const token of parsed.value.tokens) {
        if (token.kind === 'call') {
          const field = token.field;
          const fn = token.fn;
          const rows = await this.sql<Array<{ result: string | null }>>`
            SELECT ${this.sql.unsafe(fn)}(
              (attributes->>${field})::numeric
            ) AS result
            FROM indexed_entities
            WHERE workspace_id = ${workspaceId}
              AND attributes ? ${field}
              AND (attributes->>${field})::text ~ '^[0-9]+(\.[0-9]+)?$'
          `;
          const v = rows[0]?.result;
          values.push(v !== null && v !== undefined ? parseFloat(v) : 0);
        } else if (token.kind === 'number') {
          values.push(token.value);
        }
      }

      // Simple left-to-right evaluation of operators between resolved values
      const ops: string[] = parsed.value.tokens.filter((t) => t.kind === 'op').map((t) => (t as { kind: 'op'; op: string }).op);
      let result = values[0] ?? 0;
      for (let i = 0; i < ops.length; i++) {
        const rhs = values[i + 1] ?? 0;
        switch (ops[i]) {
          case '+': result += rhs; break;
          case '-': result -= rhs; break;
          case '*': result *= rhs; break;
          case '/': result = rhs !== 0 ? result / rhs : 0; break;
        }
      }

      this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + 60_000 });
      return ok({ value: result, formula, evaluatedAt: new Date().toISOString() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export class MetricRegistry {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Define or update a metric for a workspace.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name (unique per workspace)
   * @param formula - Calculation formula or expression
   * @param description - Human-readable description
   * @returns Result with the created/updated metric
   */
  async defineMetric(
    workspaceId: string,
    name: string,
    formula: string,
    description: string,
  ): Promise<Result<Metric, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof metricRow>[]>`
        INSERT INTO metrics (workspace_id, name, formula, description)
        VALUES (${workspaceId}, ${name}, ${formula}, ${description})
        ON CONFLICT (workspace_id, name) DO UPDATE
          SET formula     = EXCLUDED.formula,
              description = EXCLUDED.description,
              updated_at  = NOW()
        RETURNING *
      `;
      if (!row) return err(new Error('No row returned from INSERT'));
      log.info('Metric defined', { workspaceId, name });
      return ok(toMetric(row));
    } catch (e) {
      log.error('Failed to define metric', { workspaceId, name, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a single metric by name.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name to look up
   * @returns Result with the metric or null if not found
   */
  async getMetric(
    workspaceId: string,
    name: string,
  ): Promise<Result<Metric | null, Error>> {
    try {
      const [row] = await this.sql<z.infer<typeof metricRow>[]>`
        SELECT * FROM metrics
        WHERE workspace_id = ${workspaceId} AND name = ${name}
      `;
      return ok(row ? toMetric(row) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all metrics for a workspace.
   * @param workspaceId - Workspace identifier
   * @returns Result with array of metrics
   */
  async listMetrics(workspaceId: string): Promise<Result<Metric[], Error>> {
    try {
      const rows = await this.sql<z.infer<typeof metricRow>[]>`
        SELECT * FROM metrics
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC
      `;
      return ok(rows.map(toMetric));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a metric by name.
   * @param workspaceId - Workspace identifier
   * @param name - Metric name to delete
   * @returns Result with true if deleted, false if not found
   */
  async deleteMetric(
    workspaceId: string,
    name: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM metrics
        WHERE workspace_id = ${workspaceId} AND name = ${name}
      `;
      const deleted = result.count > 0;
      if (deleted) log.info('Metric deleted', { workspaceId, name });
      return ok(deleted);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
