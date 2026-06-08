import { Hono } from 'hono';
import { z } from 'zod';
import {
  recordUserFeedback,
  getAgentInsights,
  getRelevanceAdjustments,
  updateRelevanceWeights,
  suggestContextExpansion,
} from '@iris/semantic-core/agent-feedback-engine';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'agent-feedback' });

type Sql = Parameters<typeof recordUserFeedback>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const FeedbackSchema = z.object({
  usageId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  correctedContextJson: z.record(z.unknown()).optional(),
  feedbackSource: z.enum(['explicit', 'implicit', 'inferred']).default('explicit'),
  entityType: z.string().optional(),
});

/** POST /agents/:agentId/feedback — submit usage feedback */
app.post('/:agentId/feedback', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const agentId = c.req.param('agentId');

  const body = await c.req.json().catch(() => ({}));
  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid feedback payload', details: parsed.error.format() } }, 400);
  }

  const sql = getSql(c);
  const result = await recordUserFeedback(sql!, {
    usageId: parsed.data.usageId,
    rating: parsed.data.rating as 1 | 2 | 3 | 4 | 5,
    comment: parsed.data.comment ?? null,
    correctedContextJson: parsed.data.correctedContextJson ?? null,
    feedbackSource: parsed.data.feedbackSource,
  });

  if (result.isErr()) {
    log.error('Failed to record feedback', { error: result.error.message });
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to record feedback' } }, 500);
  }

  // Update relevance weights if entity type provided
  if (parsed.data.entityType) {
    await updateRelevanceWeights(sql!, workspaceId, parsed.data.entityType, parsed.data.rating).catch(e =>
      log.warn('Failed to update relevance weights', { error: (e as Error).message }),
    );
  }

  return c.json({ data: { feedbackId: result.value, agentId, recorded: true } }, 201);
});

/** GET /agents/:agentId/insights — aggregated feedback and context quality insights */
app.get('/:agentId/insights', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const agentId = c.req.param('agentId');

  const sql = getSql(c);
  const [insightsResult, expansionResult] = await Promise.allSettled([
    getAgentInsights(sql!, workspaceId, agentId),
    suggestContextExpansion(sql!, workspaceId, agentId),
  ]);

  const insights = insightsResult.status === 'fulfilled' && insightsResult.value.isOk()
    ? insightsResult.value.value
    : null;
  const expansion = expansionResult.status === 'fulfilled' && expansionResult.value.isOk()
    ? expansionResult.value.value
    : null;

  if (!insights) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load insights' } }, 500);
  }

  return c.json({ data: { ...insights, contextExpansionSuggestion: expansion } });
});

/** GET /entities/:entityId/feedback-score — entity quality score from feedback */
app.get('/entities/:entityType/feedback-score', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const entityType = c.req.param('entityType');

  const sql = getSql(c);
  const result = await getRelevanceAdjustments(sql!, workspaceId);

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load feedback scores' } }, 500);
  }

  const adj = result.value.find(r => r.entityType === entityType);
  return c.json({
    data: adj ?? {
      entityType,
      workspaceId,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      weightAdjustment: 0,
      lastUpdatedAt: null,
    },
  });
});

/** GET /relevance-adjustments — all entity type weight adjustments */
app.get('/relevance-adjustments', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';

  const sql = getSql(c);
  const result = await getRelevanceAdjustments(sql!, workspaceId);

  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load relevance adjustments' } }, 500);
  }

  return c.json({ data: result.value, meta: { count: result.value.length } });
});

export default app;
