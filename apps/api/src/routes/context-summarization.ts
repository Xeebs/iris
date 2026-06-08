import { Hono } from 'hono';
import { z } from 'zod';
import {
  classifyQueryIntent,
  rankContextByTaskRelevance,
  generateTaskSpecificSummary,
  optimizeSummaryStructure,
  recordSummarizationMetrics,
  getSummarizationMetrics,
  type ContextEntity,
} from '@iris/semantic-core/context-summarizer';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'context-summarization' });

type Sql = Parameters<typeof recordSummarizationMetrics>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const SummarizeSchema = z.object({
  query: z.string().min(1).max(2000),
  entities: z.array(z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    attributes: z.record(z.unknown()).default({}),
    relationships: z.array(z.object({ type: z.string(), targetId: z.string() })).optional(),
  })).min(1).max(500),
  provider: z.enum(['anthropic', 'openai', 'azure', 'gemini']).default('anthropic'),
  targetTokens: z.number().int().min(50).max(8000).default(1000),
});

const TrackMetricsSchema = z.object({
  originalTokenCount: z.number().int().min(0),
  summaryTokenCount: z.number().int().min(0),
  queryIntent: z.enum(['analytical', 'operational', 'reporting', 'synthesis']),
  satisfactionScore: z.number().min(0).max(1).optional(),
});

/** POST /context-summarization/summarize — generate task-specific summary */
app.post('/summarize', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SummarizeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const { query, entities, provider, targetTokens } = parsed.data;
  const intent = classifyQueryIntent(query);
  const ranked = rankContextByTaskRelevance(entities as ContextEntity[], intent);
  const summary = generateTaskSpecificSummary(ranked, intent, provider, targetTokens);
  const optimized = optimizeSummaryStructure(summary.content, summary.format);

  return c.json({
    data: {
      ...summary,
      content: optimized,
      intent,
      entityCount: entities.length,
    },
  });
});

/** GET /context-summarization/metrics — aggregated compression metrics */
app.get('/metrics', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const sql = getSql(c);
  const result = await getSummarizationMetrics(sql!, workspaceId);
  if (result.isErr()) {
    log.error('Failed to get summarization metrics', { error: result.error.message });
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load metrics' } }, 500);
  }
  return c.json({ data: result.value });
});

/** POST /context-summarization/metrics/track — record a summarization event */
app.post('/metrics/track', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const body = await c.req.json().catch(() => ({}));
  const parsed = TrackMetricsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const { originalTokenCount, summaryTokenCount, queryIntent, satisfactionScore } = parsed.data;
  const sql = getSql(c);
  const result = await recordSummarizationMetrics(sql!, workspaceId, originalTokenCount, summaryTokenCount, queryIntent, satisfactionScore);
  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to record metrics' } }, 500);
  }
  return c.json({ data: { recorded: true } }, 201);
});

/** POST /context-summarization/classify-intent — classify a query's intent */
app.post('/classify-intent', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ query: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'query is required' } }, 400);
  }
  const intent = classifyQueryIntent(parsed.data.query);
  return c.json({ data: { intent } });
});

export default app;
