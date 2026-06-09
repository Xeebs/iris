import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { InsightGenerator } from '@iris/semantic-core/insight-generator';
import type { InsightType, InsightSeverity, InsightGranularity } from '@iris/semantic-core/insight-generator';

const ScheduleSchema = z.object({
  entityTypes: z.array(z.string().min(1)).min(1),
  frequency: z.enum(['daily', 'weekly']),
  recipients: z.array(z.string().min(1)).min(1),
});

const FeedbackSchema = z.object({
  wasValuable: z.boolean(),
});

const DiscoverSchema = z.object({
  entityTypes: z.array(z.string().min(1)).min(1),
  workspaceId: z.string().optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/insights
 */
export function makeInsightsRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const svc = new InsightGenerator(sql);

  // GET / — list insights
  app.get('/', async (c) => {
    const insightType = c.req.query('type') as InsightType | undefined;
    const severity = c.req.query('severity') as InsightSeverity | undefined;
    const entityType = c.req.query('entityType');
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
    const cursor = c.req.query('cursor') ?? undefined;
    const result = await svc.listInsights({ insightType, severity, entityType, limit, cursor });
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    const { insights, nextCursor } = result.value;
    return c.json({ data: insights, meta: { hasMore: nextCursor !== null, nextCursor } });
  });

  // POST /discover — trigger insight discovery
  app.post('/discover', async (c) => {
    const parsed = DiscoverSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.discoverInsights(parsed.data.entityTypes, { workspaceId: parsed.data.workspaceId });
    if (result.isErr()) return c.json({ error: { code: 'discovery_error', message: result.error.message } }, 500);
    const insights = result.value;
    for (const insight of insights) {
      await svc.saveInsight({
        entityType: insight.entityType, insightType: insight.insightType,
        title: insight.title, summary: insight.summary,
        affectedCount: insight.affectedCount, severity: insight.severity,
        valueScore: insight.valueScore, evidence: insight.evidence,
      });
    }
    return c.json({ data: { discovered: insights.length, insights } }, 201);
  });

  // GET /:id/details — full insight detail
  app.get('/:id/details', async (c) => {
    const id = c.req.param('id');
    try {
      type Row = { id: string; entity_type: string; insight_type: string; title: string; summary: string; affected_count: number; severity: string; value_score: number; evidence: unknown; detected_at: Date };
      const [row] = await sql<Row[]>`SELECT * FROM generated_insights WHERE id = ${id}`;
      if (!row) return c.json({ error: { code: 'not_found', message: `Insight ${id} not found` } }, 404);
      return c.json({ data: row });
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // POST /:id/feedback — value feedback
  app.post('/:id/feedback', async (c) => {
    const id = c.req.param('id');
    const parsed = FeedbackSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.submitFeedback(id, parsed.data.wasValuable);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: { recorded: true } });
  });

  // GET /report/:entityType — insight report
  app.get('/report/:entityType', async (c) => {
    const entityType = c.req.param('entityType');
    const granularity = (c.req.query('granularity') ?? 'daily') as InsightGranularity;
    const result = await svc.generateInsightReport(entityType, granularity);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /scheduled — list scheduled reports
  app.get('/scheduled', async (c) => {
    const result = await svc.listScheduledReports();
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // POST /scheduled — create scheduled report
  app.post('/scheduled', async (c) => {
    const parsed = ScheduleSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.scheduleInsightGeneration(parsed.data.entityTypes, parsed.data.frequency, parsed.data.recipients);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  return app;
}
