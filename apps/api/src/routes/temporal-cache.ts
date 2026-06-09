import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { TemporalQueryCache } from '@iris/semantic-core/temporal-query-cache';

const DateParamSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

const PreloadBodySchema = z.object({
  intervalDays: z.number().int().min(1).max(90).optional().default(3),
});

const AnalyticsQuerySchema = z.object({
  intervalDays: z.coerce.number().int().min(1).max(90).optional().default(7),
});

/**
 * Creates the temporal cache router.
 * @param sql - Postgres client instance
 * @returns Hono router
 */
export function makeTemporalCacheRouter(sql: ReturnType<typeof postgres>) {
  const router = new Hono();
  const svc = new TemporalQueryCache(sql);

  router.get('/cache/temporal/:queryId/:date', async (c) => {
    const { queryId, date } = c.req.param();
    const parsedDate = DateParamSchema.safeParse(date);
    if (!parsedDate.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date format. Use ISO 8601 or YYYY-MM-DD.' } }, 400);
    }

    const targetDate = new Date(parsedDate.data);
    if (isNaN(targetDate.getTime())) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Unparseable date.' } }, 400);
    }

    const result = await svc.queryAsOfDate(queryId, targetDate);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    if (result.value === null) return c.json({ error: { code: 'NOT_FOUND', message: `No cache entry for query "${queryId}" at ${date}` } }, 404);
    return c.json({ data: result.value });
  });

  router.get('/cache/analytics', async (c) => {
    const qs = Object.fromEntries(new URLSearchParams(c.req.url.split('?')[1] ?? ''));
    const parsed = AnalyticsQuerySchema.safeParse(qs);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.analyzeCacheHits(parsed.data.intervalDays);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  router.post('/cache/preload', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PreloadBodySchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const result = await svc.warmCacheProactively(parsed.data.intervalDays);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return router;
}
