import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { QueryExplainer } from '@iris/semantic-core/query-explainer';
import type { VectorSearchResult } from '@iris/semantic-core/vector-store';

const log = logger.child({ service: 'query-explanation-routes' });

const ExplainBody = z.object({
  query: z.string().min(1),
  results: z.array(
    z.object({
      entity: z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        attributes: z.record(z.unknown()),
        relationships: z.array(z.object({ type: z.string(), targetId: z.string() })),
        lastModified: z.string().datetime(),
        sourceId: z.string(),
      }),
      score: z.number().min(0).max(1),
    }),
  ),
});

/**
 * @returns Hono router exposing POST /queries/:id/explain
 */
export function createQueryExplanationRoutes(): Hono {
  const router = new Hono();
  const explainer = new QueryExplainer();

  router.post('/:id/explain', async (c) => {
    const queryId = c.req.param('id');

    const parsed = ExplainBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } },
        400,
      );
    }

    const { query, results } = parsed.data;

    const hydratedResults: VectorSearchResult[] = results.map((r) => ({
      entity: {
        ...r.entity,
        lastModified: new Date(r.entity.lastModified),
      },
      score: r.score,
    }));

    log.info('Explaining query retrieval', { queryId, resultCount: results.length });

    const explanation = explainer.explainRetrieval(query, hydratedResults);

    return c.json({ data: explanation });
  });

  return router;
}
