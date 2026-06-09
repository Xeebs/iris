import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { RequestTracer } from '@iris/semantic-core/request-tracer';
import { logger } from '@iris/core/logger';

/**
 * @param sql - Postgres client
 * @returns Hono router for distributed trace querying
 */
export function createRequestTracesRoutes(sql: Sql) {
  const app = new Hono();
  const tracer = new RequestTracer(sql);

  /**
   * GET /traces — paginated search over recent root spans
   * Query params: operationName?, limit?, cursor?
   */
  app.get('/', async (c) => {
    const operationName = c.req.query('operationName') ?? null;
    const workspaceId = c.req.header('x-workspace-id') ?? null;
    const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));
    const cursor = c.req.query('cursor');

    try {
      const { spans, nextCursor } = await tracer.searchTraces(
        operationName,
        workspaceId,
        limit,
        cursor
      );
      return c.json({
        data: spans,
        meta: { hasMore: nextCursor !== null, nextCursor },
      });
    } catch (e) {
      logger.error('Failed to search traces', { error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to search traces' } }, 500);
    }
  });

  /**
   * GET /traces/:traceId — full span waterfall for a trace
   */
  app.get('/:traceId', async (c) => {
    const traceId = c.req.param('traceId');

    try {
      const spans = await tracer.getTrace(traceId);
      if (spans.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Trace not found' } }, 404);
      }
      return c.json({ data: spans });
    } catch (e) {
      logger.error('Failed to get trace', { traceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get trace' } }, 500);
    }
  });

  /**
   * POST /traces/analyze — critical path and latency analysis for a trace
   * Body: { traceId: string }
   */
  app.post('/analyze', async (c) => {
    let body: { traceId?: string };
    try {
      body = await c.req.json() as { traceId?: string };
    } catch {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON' } }, 400);
    }

    if (!body.traceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'traceId is required' } }, 400);
    }

    try {
      const analysis = await tracer.analyzeTrace(body.traceId);
      return c.json({ data: analysis });
    } catch (e) {
      logger.error('Failed to analyze trace', { traceId: body.traceId, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to analyze trace' } }, 500);
    }
  });

  return app;
}
