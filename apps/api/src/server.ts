import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { clerkMiddleware } from '@hono/clerk-auth';
import { PgvectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { requireAuth, errorHandler, defaultRateLimiter, syncRateLimiter } from './middleware/index.js';
import { createConnectorRoutes } from './routes/connectors.js';
import { createEntityRoutes } from './routes/entities.js';
import { createQueryRoutes } from './routes/queries.js';
import { createAuditRoutes } from './routes/audit.js';
import { createGlossaryRoutes } from './routes/glossary.js';
import { createMetricRoutes } from './routes/metrics.js';
import { createAnalyticsRoutes } from './routes/analytics.js';
import { createIndexStatusRoutes } from './routes/index-status.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createGraphRoutes } from './routes/graph.js';
import { createPiiConfigRoutes } from './routes/pii-config.js';

export { createApp };

const log = logger.child({ service: 'api' });

function createApp(
  vectorStore: PgvectorStore,
  sql: ReturnType<typeof postgres>,
  openAiKey: string,
  redis?: InstanceType<typeof Redis>,
): Hono {
  const app = new Hono();

  app.use('*', clerkMiddleware());

  const authed = new Hono();
  authed.use('*', requireAuth);

  // Global rate limit: 100 req/min per user
  if (redis) {
    authed.use('*', defaultRateLimiter(redis));
  }

  const connectorRoutes = createConnectorRoutes(sql);

  // Tighter limit on sync triggers: 10 req/min per user
  if (redis) {
    connectorRoutes.use('/:id/sync', syncRateLimiter(redis));
  }

  authed.route('/connectors', connectorRoutes);
  authed.route('/entities', createEntityRoutes(vectorStore));
  authed.route('/queries', createQueryRoutes(vectorStore, openAiKey));
  authed.route('/audit', createAuditRoutes(sql));
  authed.route('/glossary', createGlossaryRoutes(sql));
  authed.route('/metrics', createMetricRoutes(sql));
  authed.route('/analytics', createAnalyticsRoutes(sql));
  authed.route('/index', createIndexStatusRoutes(sql));
  authed.route('/graph', createGraphRoutes(sql));
  authed.route('/pii-config', createPiiConfigRoutes(sql));

  // Webhook route is unauthenticated (events arrive from external services)
  app.route('/api/v1/webhooks', createWebhookRoutes(sql));

  app.route('/api/v1', authed);

  app.onError(errorHandler);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `Route ${c.req.path} not found` } }, 404),
  );

  return app;
}

async function main(): Promise<void> {
  const pgUrl = process.env['DATABASE_URL'];
  const openAiKey = process.env['OPENAI_API_KEY'] ?? '';
  const port = Number(process.env['PORT'] ?? 3001);

  if (!pgUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const sql = postgres(pgUrl);
  const vectorStore = new PgvectorStore(pgUrl);
  await vectorStore.initialize();
  const redis = new Redis(redisUrl);

  const app = createApp(vectorStore, sql, openAiKey, redis);

  serve({ fetch: app.fetch, port }, (info) => {
    log.info('Iris API server started', { port: info.port });
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
