import { Hono } from 'hono';
import { z } from 'zod';
import {
  suggestRelationshipCreation,
  confirmInferredRelationship,
  rejectInferredRelationship,
  detectImplicitRelationships,
  validateInferredRelationship,
} from '@iris/semantic-core/relationship-inference';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'relationship-inference' });

type Sql = Parameters<typeof suggestRelationshipCreation>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const ScoreSchema = z.object({
  sourceEntityId: z.string().min(1),
  sourceEntityType: z.string().min(1),
  targetEntityId: z.string().min(1),
  targetEntityType: z.string().min(1),
  cooccurrenceScore: z.number().min(0).max(1).default(0),
  embeddingSimilarity: z.number().min(0).max(1).default(0),
});

/** GET /graph/inferred-relationships — list pending suggestions */
app.get('/inferred-relationships', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const topKStr = c.req.query('topK') ?? '20';
  const topK = Math.min(parseInt(topKStr, 10) || 20, 100);

  const sql = getSql(c);
  const result = await suggestRelationshipCreation(sql!, workspaceId, topK);
  if (result.isErr()) {
    log.error('Failed to get inferred relationships', { error: result.error.message });
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load suggestions' } }, 500);
  }
  return c.json({ data: result.value });
});

/** POST /graph/inferred/:relId/confirm — admin accepts suggestion */
app.post('/inferred/:relId/confirm', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const relId = c.req.param('relId');

  const sql = getSql(c);
  const result = await confirmInferredRelationship(sql!, workspaceId, relId);
  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to confirm relationship' } }, 500);
  }
  return c.json({ data: { confirmed: true, relId } });
});

/** POST /graph/inferred/:relId/reject — admin rejects suggestion */
app.post('/inferred/:relId/reject', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const relId = c.req.param('relId');

  const sql = getSql(c);
  const result = await rejectInferredRelationship(sql!, workspaceId, relId);
  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to reject relationship' } }, 500);
  }
  return c.json({ data: { rejected: true, relId } });
});

/** POST /graph/score-relationship — score a potential inferred link */
app.post('/score-relationship', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ScoreSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const { sourceEntityId, sourceEntityType, targetEntityId, targetEntityType, cooccurrenceScore, embeddingSimilarity } = parsed.data;
  const score = detectImplicitRelationships(sourceEntityId, sourceEntityType, targetEntityId, targetEntityType, cooccurrenceScore, embeddingSimilarity);
  const valid = validateInferredRelationship(score);

  return c.json({ data: { ...score, meetsThreshold: valid } });
});

export default app;
