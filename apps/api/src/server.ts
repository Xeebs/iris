import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { clerkMiddleware } from '@hono/clerk-auth';
import { PgvectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { requireAuth, errorHandler } from './middleware/index.js';
import { connectorRoutes } from './routes/connectors.js';
import { createEntityRoutes } from './routes/entities.js';
import { createQueryRoutes } from './routes/queries.js';
import { createAuditRoutes } from './routes/audit.js';
import { createGlossaryRoutes } from './routes/glossary.js';
import { createMetricRoutes } from './routes/metrics.js';

export { createApp };

const log = logger.child({ service: 'api' });

function createApp(vectorStore: PgvectorStore, sql: ReturnType<typeof postgres>, openAiKey: string): Hono {
  const app = new Hono();

  app.use('*', clerkMiddleware());

  app.route('/api/v1/connectors', connectorRoutes);

  const authed = new Hono();
  authed.use('*', requireAuth);
  authed.route('/entities', createEntityRoutes(vectorStore));
  authed.route('/queries', createQueryRoutes(vectorStore, openAiKey));
  authed.route('/audit', createAuditRoutes(sql));
  authed.route('/glossary', createGlossaryRoutes(sql));
  authed.route('/metrics', createMetricRoutes(sql));

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

  const sql = postgres(pgUrl);
  const vectorStore = new PgvectorStore(pgUrl);
  await vectorStore.initialize();

  const app = createApp(vectorStore, sql, openAiKey);

  serve({ fetch: app.fetch, port }, (info) => {
    log.info('Iris API server started', { port: info.port });
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
