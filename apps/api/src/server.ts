import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { clerkMiddleware } from '@hono/clerk-auth';
import { PgvectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

import { requireAuth, errorHandler, defaultRateLimiter, syncRateLimiter, syncQuota, webhookQuota } from './middleware/index.js';
import { checkHealth } from './health.js';
import { initTelemetry, shutdownTelemetry } from './telemetry.js';
import { createConnectorRoutes } from './routes/connectors.js';
import { createEntityRoutes } from './routes/entities.js';
import { createQueryRoutes } from './routes/queries.js';
import { createAuditRoutes } from './routes/audit.js';
import { createGlossaryRoutes } from './routes/glossary.js';
import { createMetricRoutes } from './routes/metrics.js';
import { createAnalyticsRoutes } from './routes/analytics.js';
import { createIndexStatusRoutes } from './routes/index-status.js';
import { createWebhookRoutes, createWebhookEventsRoutes } from './routes/webhooks.js';
import { createGraphRoutes } from './routes/graph.js';
import { createPiiConfigRoutes } from './routes/pii-config.js';
import { createSuggestionsRoutes } from './routes/suggestions.js';
import { createExportRoutes } from './routes/export.js';
import { createWorkspaceConfigRoutes } from './routes/workspace-config.js';
import { createIndexOptimizationRoutes } from './routes/index-optimization.js';
import { createWorkflowTemplateRoutes } from './routes/workflow-templates.js';
import { createWorkspaceBenchmarkingRoutes } from './routes/workspace-benchmarking.js';
import { createAdminDlqRoutes } from './routes/admin-dlq.js';
import { createAdminDedupRoutes } from './routes/admin-dedup.js';
import { createWorkspaceExportRoutes } from './routes/workspace-export.js';
import { createAdminBackupRoutes } from './routes/admin-backup.js';
import { createCustomConnectorRoutes } from './routes/custom-connectors.js';
import { createTeamManagementRoutes } from './routes/team-management.js';
import { createWorkspaceDeletionRoutes } from './routes/workspace-deletion.js';
import { createOnboardingRoutes } from './routes/onboarding.js';
import { openApiSpec } from './openapi.js';

export { createApp };

const log = logger.child({ service: 'api' });

function createApp(
  vectorStore: PgvectorStore,
  sql: ReturnType<typeof postgres>,
  openAiKey: string,
  redis?: InstanceType<typeof Redis>,
  redisUrl?: string,
): Hono {
  const app = new Hono();

  // Health/readiness probes — unauthenticated, no Clerk middleware
  app.get('/health', async (c) => {
    const result = await checkHealth(sql, redis);
    return c.json(result, result.status === 'ok' ? 200 : 503);
  });

  app.get('/ready', (c) => c.json({ status: 'ready', timestamp: new Date().toISOString() }, 200));

  // OpenAPI spec and Swagger UI — public, no auth required
  app.get('/openapi.json', (c) => c.json(openApiSpec));

  app.get('/docs', (c) =>
    c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Iris API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`),
  );

  app.use('*', clerkMiddleware());

  const authed = new Hono();
  authed.use('*', requireAuth);

  // Global rate limit: 100 req/min per user
  if (redis) {
    authed.use('*', defaultRateLimiter(redis));
  }

  const connectorRoutes = createConnectorRoutes(sql);

  // Tighter limit on sync triggers: sliding window + token-bucket quota with burst
  if (redis) {
    connectorRoutes.use('/:id/sync', syncRateLimiter(redis));
    connectorRoutes.use('/:id/sync', syncQuota(redis));
    authed.use('/webhooks/*', webhookQuota(redis));
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
  authed.route('/context-suggestions', createSuggestionsRoutes(sql));
  authed.route('/export', createExportRoutes(sql));
  authed.route('/workspace', createWorkspaceConfigRoutes(sql));
  authed.route('/index-optimization', createIndexOptimizationRoutes(sql));
  authed.route('/workflow-templates', createWorkflowTemplateRoutes(sql));
  authed.route('/workspace', createWorkspaceBenchmarkingRoutes(sql));

  if (redisUrl) {
    authed.route('/admin/dlq', createAdminDlqRoutes(sql, redisUrl));
  }
  authed.route('/admin/dedup', createAdminDedupRoutes(sql, vectorStore));
  authed.route('/workspace/export', createWorkspaceExportRoutes(sql));
  authed.route('/admin/backup', createAdminBackupRoutes(sql));
  authed.route('/custom-connectors', createCustomConnectorRoutes(sql));
  authed.route('/workspace/members', createTeamManagementRoutes(sql));
  authed.route('/workspace/deletion', createWorkspaceDeletionRoutes(sql));
  authed.route('/onboarding', createOnboardingRoutes(sql));

  // Webhook routes: inbound (unauthenticated) + events status (authenticated)
  app.route('/api/v1/webhooks', createWebhookRoutes(sql));
  authed.route('/webhooks', createWebhookEventsRoutes(sql));

  app.route('/api/v1', authed);

  app.onError(errorHandler);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `Route ${c.req.path} not found` } }, 404),
  );

  return app;
}

async function main(): Promise<void> {
  initTelemetry();

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

  const app = createApp(vectorStore, sql, openAiKey, redis, redisUrl);

  serve({ fetch: app.fetch, port }, (info) => {
    log.info('Iris API server started', { port: info.port });
  });

  process.on('SIGTERM', async () => {
    await shutdownTelemetry();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
