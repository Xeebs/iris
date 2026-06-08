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
import { createBenchmarkingRoutes } from './routes/benchmarking.js';
import { createAdminDlqRoutes } from './routes/admin-dlq.js';
import { createAdminDedupRoutes } from './routes/admin-dedup.js';
import { createWorkspaceExportRoutes } from './routes/workspace-export.js';
import { createAdminBackupRoutes } from './routes/admin-backup.js';
import { createCustomConnectorRoutes } from './routes/custom-connectors.js';
import { createTeamManagementRoutes } from './routes/team-management.js';
import { createWorkspaceDeletionRoutes } from './routes/workspace-deletion.js';
import { createOnboardingRoutes } from './routes/onboarding.js';
import { createAdminPerformanceRoutes } from './routes/admin-performance.js';
import { createAdminConsoleRoutes } from './routes/admin-console.js';
import { createAlertsRoutes } from './routes/alerts.js';
import { createAdminQueryAnalyticsRoutes } from './routes/admin-query-analytics.js';
import { createEntityLinkingRoutes } from './routes/entity-linking.js';
import { createAdminSyncMonitoringRoutes } from './routes/admin-sync-monitoring.js';
import { createEntityAuditRoutes } from './routes/entity-audit.js';
import { createAuditLogRoutes } from './routes/audit-logs.js';
import { createRequestTracesRoutes } from './routes/request-traces.js';
import { createSyncDiagnosticsRoutes } from './routes/sync-diagnostics.js';
import { createSnapshotRoutes } from './routes/snapshots.js';
import { createEmailTemplateRoutes } from './routes/email-templates.js';
import { createPerformanceRoutes } from './routes/performance.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createBillingRoutes } from './routes/billing.js';
import { createCostOptimizerRoutes } from './routes/cost-optimizer.js';
import { createMarketplaceRoutes } from './routes/marketplace.js';
import { createCacheStatsRoutes } from './routes/cache-stats.js';
import { createAdminResilienceRoutes } from './routes/admin-resilience.js';
import { createAdminEmbeddingRoutes } from './routes/admin-embedding.js';
import { createVectorHealthRoutes } from './routes/vector-health.js';
import { createEntityLineageRoutes } from './routes/entity-lineage.js';
import { createAdminSystemRoutes } from './routes/admin-system.js';
import { createDataImportExportRoutes } from './routes/data-import-export.js';
import { createMcpResourcesRoutes } from './routes/mcp-resources.js';
import { createAdminSyncQualityRoutes } from './routes/admin-sync-quality.js';
import { createDocumentIndexingRoutes } from './routes/document-indexing.js';
import { createSearchTuningRoutes } from './routes/search-tuning.js';
import { createCostAnalyticsRoutes } from './routes/cost-analytics.js';
import { createConnectorRecipeRoutes } from './routes/connector-recipes.js';
import { createAdminIndexRoutes } from './routes/admin-index.js';
import { createStreamingContextRoutes } from './routes/streaming-context.js';
import { createIndexCompositionRoutes } from './routes/index-composition.js';
import { createAutoTuningRoutes } from './routes/auto-tuning.js';
import { createProvidersRoutes } from './routes/providers.js';
import { createComplianceRoutes } from './routes/compliance.js';
import { createLineageRoutes } from './routes/lineage.js';
import { createDedupRoutes } from './routes/dedup-reconciliation.js';
import { createProactiveContextRoutes } from './routes/proactive-context.js';
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
  authed.route('/benchmarks', createBenchmarkingRoutes(sql));

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
  authed.route('/admin/performance', createAdminPerformanceRoutes(sql));
  authed.route('/admin', createAdminConsoleRoutes(sql));
  authed.route('/workspace/alerts', createAlertsRoutes(sql));
  authed.route('/admin/analytics', createAdminQueryAnalyticsRoutes(sql));
  authed.route('/admin/entity-linking', createEntityLinkingRoutes(sql));

  if (redisUrl) {
    authed.route('/admin/sync-monitoring', createAdminSyncMonitoringRoutes(sql, redisUrl));
  }

  authed.route('/entity-audit', createEntityAuditRoutes(sql));
  authed.route('/admin/audit-logs', createAuditLogRoutes(sql));
  authed.route('/admin/request-traces', createRequestTracesRoutes(sql));
  authed.route('/admin/sync-diagnostics', createSyncDiagnosticsRoutes(sql));
  authed.route('/admin/snapshots', createSnapshotRoutes(sql));
  authed.route('/email-templates', createEmailTemplateRoutes(sql));
  authed.route('/performance', createPerformanceRoutes(sql));
  authed.route('/sessions', createSessionRoutes(sql));
  authed.route('/billing', createBillingRoutes(sql));
  authed.route('/cost-optimizer', createCostOptimizerRoutes(sql));
  authed.route('/marketplace', createMarketplaceRoutes(sql));
  if (redis) {
    authed.route('/cache', createCacheStatsRoutes(redis));
  }
  authed.route('/admin/connectors/resilience', createAdminResilienceRoutes(sql));
  authed.route('/admin/embedding-config', createAdminEmbeddingRoutes(sql));
  authed.route('/admin/vector-health', createVectorHealthRoutes(sql));
  authed.route('/entities', createEntityLineageRoutes(sql));
  authed.route('/lineage', createEntityLineageRoutes(sql));
  authed.route('/data', createDataImportExportRoutes(sql));
  authed.route('/mcp/resources', createMcpResourcesRoutes());
  authed.route('/admin/connectors', createAdminSyncQualityRoutes(sql));
  authed.route('/admin/system', createAdminSystemRoutes(sql));
  authed.route('/document-indexing', createDocumentIndexingRoutes(sql));
  authed.route('/search-tuning', createSearchTuningRoutes(sql));
  authed.route('/cost-analytics', createCostAnalyticsRoutes(sql));
  authed.route('/recipes', createConnectorRecipeRoutes(sql));
  authed.route('/admin/index', createAdminIndexRoutes(sql));
  authed.route('/context', createStreamingContextRoutes(sql));
  authed.route('/analytics/index', createIndexCompositionRoutes(sql));
  authed.route('/optimization', createAutoTuningRoutes(sql));
  authed.route('/providers', createProvidersRoutes(sql));
  authed.route('/compliance', createComplianceRoutes(sql));
  authed.route('/lineage', createLineageRoutes(sql));
  authed.route('/dedup', createDedupRoutes(sql));
  authed.route('/proactive', createProactiveContextRoutes(sql));

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
