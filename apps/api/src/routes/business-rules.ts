import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { RuleEngine } from '@iris/semantic-core/business-rule-engine';
import type { RuleSeverity, RuleAction, ConditionOperator } from '@iris/semantic-core/business-rule-engine';

const ConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['required', 'not_empty', 'matches', 'min_length', 'max_length', 'one_of']),
  value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
});

const DefineRuleSchema = z.object({
  name: z.string().min(1),
  entityType: z.string().min(1),
  conditions: z.array(ConditionSchema).min(1),
  action: z.enum(['reject', 'warn', 'log']),
  severity: z.enum(['error', 'warning', 'info']),
  description: z.string().optional().default(''),
});

const ValidateEntitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  attributes: z.record(z.unknown()),
});

const AutoFixSchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1),
  trustLevel: z.enum(['safe', 'aggressive']).optional().default('safe'),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/admin/rules
 */
export function makeBusinessRulesRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const engine = new RuleEngine(sql);

  // GET / — list all rules
  app.get('/', async (c) => {
    const entityType = c.req.query('entityType');
    const result = await engine.listRules(entityType);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // POST / — define rule
  app.post('/', async (c) => {
    const parsed = DefineRuleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { name, entityType, conditions, action, severity, description } = parsed.data;
    const result = await engine.defineRule(
      name, entityType,
      conditions.map((c) => ({ field: c.field, operator: c.operator as ConditionOperator, value: c.value as never })),
      action as RuleAction, severity as RuleSeverity, description,
    );
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  // POST /validate — validate an entity against all rules
  app.post('/validate', async (c) => {
    const parsed = ValidateEntitySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await engine.evaluateEntity(parsed.data);
    if (result.isErr()) return c.json({ error: { code: 'evaluation_error', message: result.error.message } }, 500);
    const violations = result.value;
    return c.json({ data: { valid: violations.length === 0, violations } });
  });

  // GET /violations — violation statistics
  app.get('/violations', async (c) => {
    const window = (c.req.query('window') ?? '7d') as '1d' | '7d' | '30d';
    const result = await engine.trackRuleViolations(window);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // POST /auto-fix — auto-correct violations
  app.post('/auto-fix', async (c) => {
    const parsed = AutoFixSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await engine.autoCorrectViolations(parsed.data.entityIds, parsed.data.trustLevel);
    if (result.isErr()) return c.json({ error: { code: 'correction_error', message: result.error.message } }, 500);
    const corrections = result.value;
    return c.json({ data: { applied: corrections.filter((c) => c.applied).length, skipped: corrections.filter((c) => !c.applied).length, corrections } });
  });

  return app;
}
