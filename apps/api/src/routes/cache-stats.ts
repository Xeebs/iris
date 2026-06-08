import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { ResponseCache } from '@iris/cache/response-cache';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'cache-stats' });

/**
 * @param redis - Redis client for response cache stats
 * @returns Hono router for /api/v1/cache
 */
export function createCacheStatsRoutes(redis: Redis): Hono {
  const app = new Hono();
  const cache = new ResponseCache(redis);

  /** GET /api/v1/cache/stats — response cache hit rate, eviction counts, memory estimate */
  app.get('/stats', async (c) => {
    try {
      const stats = await cache.getStats();
      return c.json({ data: stats });
    } catch (e) {
      log.error('Failed to get cache stats', { error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve cache stats' } }, 500);
    }
  });

  /** DELETE /api/v1/cache/stats — reset hit/miss counters */
  app.delete('/stats', async (c) => {
    try {
      await cache.resetStats();
      return c.json({ data: { reset: true } });
    } catch (e) {
      log.error('Failed to reset cache stats', { error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to reset cache stats' } }, 500);
    }
  });

  /** DELETE /api/v1/cache/workspace/:workspaceId — invalidate all cached responses for a workspace */
  app.delete('/workspace/:workspaceId', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const requestedWorkspace = c.get('workspaceId') as string | undefined;

    if (requestedWorkspace && requestedWorkspace !== workspaceId) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot invalidate another workspace cache' } }, 403);
    }

    try {
      const deleted = await cache.invalidateWorkspace(workspaceId);
      log.info('Workspace cache invalidated', { workspaceId, deleted });
      return c.json({ data: { deleted, workspaceId } });
    } catch (e) {
      log.error('Failed to invalidate workspace cache', { workspaceId, error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to invalidate cache' } }, 500);
    }
  });

  return app;
}
