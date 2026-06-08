import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { WebhookReliabilityManager } from '@iris/semantic-core/webhook-reliability';

const ReplaySchema = z.object({
  replayedBy: z.string().min(1).default('admin'),
});

function workspaceId(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('x-workspace-id') ?? 'default';
}

export function makeWebhookDlqRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const manager = new WebhookReliabilityManager(sql);

  app.get('/', async (c) => {
    const cursor = c.req.query('cursor');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const result = await manager.listDlq(workspaceId(c), limit, cursor);
    if (result.isErr()) {
      return c.json({ error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
    }
    const { events, nextCursor } = result.value;
    return c.json({ data: events, meta: { nextCursor, hasMore: !!nextCursor } });
  });

  app.post('/:id/replay', async (c) => {
    const parsed = ReplaySchema.safeParse(await c.req.json().catch(() => ({})));
    const replayedBy = parsed.success ? parsed.data.replayedBy : 'admin';
    const result = await manager.markReplayed(c.req.param('id'), workspaceId(c), replayedBy);
    if (result.isErr()) {
      return c.json({ error: { code: 'REPLAY_FAILED', message: result.error.message } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'DLQ event not found or already replayed' } }, 404);
    }
    return c.json({ data: { replayed: true } });
  });

  app.get('/analyze', async (c) => {
    const result = await manager.analyzePatterns(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'ANALYZE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/prune', async (c) => {
    const result = await manager.pruneOldEvents(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'PRUNE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { prunedCount: result.value } });
  });

  return app;
}
