import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { clerkMiddleware } from '@hono/clerk-auth';
import { PgvectorStore } from '@iris/semantic-core';
import { ConnectorHealthService } from '@iris/semantic-core/connector-health-service';
import { createDefaultProvider } from '@iris/semantic-core/embedding-provider';
import { logger } from '@iris/core/logger';

import { SyncJobQueue } from '@iris/queue';

import { requireAuth, demoApiKeyAuth, errorHandler, defaultRateLimiter, syncRateLimiter, syncQuota, webhookQuota } from './middleware/index.js';
import { registerConnectors } from './connector-registration.js';
import { checkHealth } from './health.js';
import { initTelemetry, shutdownTelemetry } from './telemetry.js';
import { createConnectorRoutes, createConnectorTypeRoutes } from './routes/connectors.js';
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
import { createEntitySearchRoutes } from './routes/entity-search.js';
import { createGranularPermissionsRoutes } from './routes/granular-permissions.js';
import { makePermissionRouter } from './routes/permission-management.js';
import { createWorkflowRoutes } from './routes/workflows.js';
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
import { createStreamingQueryRoutes } from './routes/streaming-queries.js';
import { createVectorStoreAdminRoutes } from './routes/vector-store-admin.js';
import { createIndexCompositionRoutes } from './routes/index-composition.js';
import { createAutoTuningRoutes } from './routes/auto-tuning.js';
import { createProviderRoutes } from './routes/providers.js';
import { createComplianceRoutes } from './routes/compliance.js';
import { createLineageRoutes } from './routes/lineage.js';
import { createDedupRoutes } from './routes/dedup-reconciliation.js';
import { createProactiveContextRoutes } from './routes/proactive-context.js';
import { createNlpConfigRoutes } from './routes/nlp-config.js';
import { createSsoConfigRoutes } from './routes/sso-config.js';
import { createDataQualityEngineRoutes } from './routes/data-quality-engine-routes.js';
import { createDemoBootstrapRoutes } from './routes/demo-bootstrap.js';
import { createApiKeyManagementRoutes } from './routes/api-key-management.js';
import { createSearchRoutes } from './routes/search.js';
import { createUsageRoutes } from './routes/usage.js';
import { createMcpToolsRoutes } from './routes/mcp-tools.js';
import { createQueryAnalyticsRoutes } from './routes/query-analytics.js';
import { createConnectorHealthRoutes } from './routes/connector-health.js';
import { createDocumentsRoutes } from './routes/documents.js';
import { createSyncMetricsRoutes } from './routes/sync-metrics.js';
import { createContextSearchRoutes } from './routes/context-search.js';
import { createEnrichmentConfigRoutes } from './routes/enrichment-config.js';
import { createEntityValidationRoutes } from './routes/entity-validation.js';
import { createBulkOperationsRoutes } from './routes/bulk-operations.js';
import { makeAnalyticsRouter } from './routes/analytics-pipeline.js';
import { makeInsightsRouter } from './routes/insights.js';
import { createDedupAdminRoutes } from './routes/dedup-admin.js';
import { createEntityChangeStreamRoutes } from './routes/entity-change-stream.js';
import { createEnrichmentQualityRoutes } from './routes/enrichment-quality.js';
import { createFreshnessTrackingRoutes } from './routes/freshness-tracking.js';
import { createGovernanceDashboardRoutes } from './routes/governance-dashboard.js';
import { createAdminCostAuditRoutes } from './routes/admin-cost-audit.js';
import { createWorkspaceCostRoutes } from './routes/workspace-costs.js';
import { createComputedMetricsRoutes } from './routes/computed-metrics.js';
import { makeApiVersionAdminRouter } from './routes/api-version-admin.js';
import { makeBusinessRulesRouter } from './routes/business-rules.js';
import { createCacheOptimizationRoutes } from './routes/cache-optimization.js';
import { createCachePrewarmingRoutes } from './routes/cache-prewarming.js';
import { createConnectorPerformanceRoutes } from './routes/connector-performance.js';
import { createDataQualityRoutes } from './routes/data-quality.js';
import { makeQuotaRouter } from './routes/quota-management.js';
import { createSloAdminRoutes } from './routes/slo-admin.js';
import { makeBackupRecoveryRouter } from './routes/backup-recovery.js';
import { createBudgetManagementRoutes } from './routes/budget-management.js';
import { createCircuitBreakerAdminRoutes } from './routes/circuit-breaker-admin.js';
import { createComplianceAuditRoutes } from './routes/compliance-audit.js';
import { createConnectorBenchmarksRoutes } from './routes/connector-benchmarks.js';
import { makeCostAttributionRouter } from './routes/cost-attribution.js';
import { createDataLineageRoutes } from './routes/data-lineage.js';
import { makeEntityReconciliationRouter } from './routes/entity-reconciliation.js';
import { makeBatchRecommendationsRouter } from './routes/batch-recommendations.js';
import { createConnectorHealthScorecardsRoutes } from './routes/connector-health-scorecards.js';
import { createDsrRoutes } from './routes/dsr.js';
import { createEntityChangeSubscriptionsRoutes } from './routes/entity-change-subscriptions.js';
import { makeEntityLifecycleRouter, makeLifecycleAdminRouter } from './routes/entity-lifecycle.js';
import { createSyncOptimizerRoutes } from './routes/sync-optimizer.js';
import { createAgentFeedbackRoutes } from './routes/agent-feedback.js';
import { createContextDeltasRoutes } from './routes/context-deltas.js';
import { createContextSummarizationRoutes } from './routes/context-summarization.js';
import { createContextVersioningRoutes } from './routes/context-versioning.js';
import { createFieldMappingsRoutes } from './routes/field-mappings.js';
import { createEventStreamsRoutes } from './routes/event-streams.js';
import { createGraphQLRoutes } from './routes/graphql.js';
import { makeHaAdminRouter } from './routes/ha-admin.js';
import { createHealthForecastRoutes } from './routes/health-forecasts.js';
import { createIndexRepairRoutes } from './routes/index-repair.js';
import { createLlmProviderRoutes } from './routes/llm-providers.js';
import { createMcpResourceDiscoveryRoutes } from './routes/mcp-resource-discovery.js';
import { createMcpStreamingRoutes } from './routes/mcp-streaming.js';
import { createMcpSubscriptionRoutes } from './routes/mcp-subscriptions.js';
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

  registerConnectors();

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

  // Demo bootstrap — unauthenticated workspace + MCP API key creation.
  // Mounted before Clerk middleware; the route itself 404s unless DEMO_MODE=true.
  if (process.env['DEMO_MODE'] === 'true') {
    log.warn('DEMO_MODE enabled — /api/v1/demo/bootstrap is open (never use in production)');
    app.route('/api/v1/demo', createDemoBootstrapRoutes(sql));
  }

  // Public connector-type catalog — the onboarding UI lists available connector
  // types before the user has a workspace API key. Static manifest metadata only;
  // registered before the authed router so it answers ahead of auth middleware.
  app.route('/api/v1/connectors', createConnectorTypeRoutes());

  // Clerk's middleware throws "Missing Clerk Secret key" on every request when
  // CLERK_SECRET_KEY is unset, 500ing all /api/v1 routes before demoApiKeyAuth
  // can run. In DEMO_MODE auth is handled by demoApiKeyAuth + requireAuth
  // (which still 401s anything unauthenticated), so skip Clerk entirely.
  if (process.env['DEMO_MODE'] !== 'true') {
    app.use('*', clerkMiddleware());
  }

  const authed = new Hono();
  if (process.env['DEMO_MODE'] === 'true') {
    authed.use('*', demoApiKeyAuth(sql));
  }
  authed.use('*', requireAuth);

  // Global rate limit: 100 req/min per user
  if (redis) {
    authed.use('*', defaultRateLimiter(redis));
  }

  // Without a SyncJobQueue, POST /connectors/:id/sync silently no-ops.
  const connectorRoutes = createConnectorRoutes(
    sql,
    redisUrl ? new SyncJobQueue(redisUrl) : undefined,
    undefined,
    new ConnectorHealthService(sql),
  );

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
  authed.route('/sso', createSsoConfigRoutes(sql));

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
  authed.route('/providers', createProviderRoutes(sql));
  authed.route('/compliance', createComplianceRoutes(sql));
  authed.route('/lineage', createLineageRoutes(sql));
  authed.route('/dedup', createDedupRoutes(sql));
  authed.route('/proactive', createProactiveContextRoutes(sql));
  authed.route('/nlp-config', createNlpConfigRoutes(sql));
  authed.route('/data-quality', createDataQualityEngineRoutes(sql));
  authed.route('/streaming-queries', createStreamingQueryRoutes(sql));
  authed.route('/admin/vector-store', createVectorStoreAdminRoutes(sql));

  // Permission management + granular field/connector-level permissions.
  // Both routers share the /permissions prefix; their sub-paths do not overlap
  // (roles/templates/evaluate vs fields/connectors).
  authed.route('/permissions', makePermissionRouter(sql));
  authed.route('/permissions', createGranularPermissionsRoutes(sql));

  // Workflows — the dashboard /workflows page calls /api/v1/workflows (was 404).
  authed.route('/workflows', createWorkflowRoutes(sql));

  // Entity search + suggestions (paths are /entities/search, /entities/search-suggestions).
  // The route uses a narrow tagged-template SqlFn (for mockability); the postgres
  // Sql client satisfies that contract at runtime but differs nominally from Promise.
  authed.route('/', createEntitySearchRoutes(sql as unknown as Parameters<typeof createEntitySearchRoutes>[0]));

  // Batch 2: api-keys, search, usage/limits, mcp-tools, query-analytics,
  // connector-health sub-paths, documents.
  // Routes that declare a local SqlFn typedef need the same cast as entity-search:
  // the postgres Sql<{}> satisfies the contract at runtime but not structurally.
  type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  const sqlFn = sql as unknown as SqlFn;
  const masterSecret = process.env['MASTER_SECRET'] ?? '';
  authed.route('/api-keys', createApiKeyManagementRoutes(sql, masterSecret));
  authed.route('/search', createSearchRoutes(sql));
  authed.route('/', createUsageRoutes(sqlFn));
  authed.route('/mcp-tools', createMcpToolsRoutes(sqlFn));
  authed.route('/query-analytics', createQueryAnalyticsRoutes(sql));
  authed.route('/connectors', createConnectorHealthRoutes(sqlFn));
  authed.route('/documents', createDocumentsRoutes(sql as never));

  // Batch 3: sync-metrics (sub-paths under /connectors), context-search,
  // enrichments, validation, bulk entity ops, analytics pipeline, insights.
  authed.route('/connectors', createSyncMetricsRoutes(sqlFn));
  authed.route('/mcp-responses', createContextSearchRoutes(sql));
  authed.route('/enrichments', createEnrichmentConfigRoutes(sql));
  authed.route('/validation', createEntityValidationRoutes(sql));
  authed.route('/entities', createBulkOperationsRoutes(sql as never));
  authed.route('/analytics', makeAnalyticsRouter(sql));
  authed.route('/insights', makeInsightsRouter(sql));

  // Batch 4: dedup-admin, entity-change-stream, enrichment-quality, freshness-tracking,
  // governance-dashboard, admin-cost-audit, workspace-costs, computed-metrics.
  authed.route('/admin/dedup', createDedupAdminRoutes(sql));
  authed.route('/entities', createEntityChangeStreamRoutes(sql));
  authed.route('/enrichment', createEnrichmentQualityRoutes(sql as never));
  authed.route('/freshness', createFreshnessTrackingRoutes(sql as never));
  authed.route('/governance', createGovernanceDashboardRoutes(sql));
  authed.route('/admin/cost-audit', createAdminCostAuditRoutes(sql));
  authed.route('/workspaces', createWorkspaceCostRoutes(sql));
  authed.route('/metrics/computed', createComputedMetricsRoutes(sql));

  // Batch 5: api-version-admin, business-rules, cache-optimization, cache-prewarming,
  // connector-performance, data-quality, quota-management, slo-admin.
  authed.route('/admin/api-versions', makeApiVersionAdminRouter(sql));
  authed.route('/admin/rules', makeBusinessRulesRouter(sql));
  authed.route('/cache-optimization', createCacheOptimizationRoutes(sql));
  authed.route('/cache-prewarming', createCachePrewarmingRoutes(sqlFn));
  authed.route('/connectors', createConnectorPerformanceRoutes(sql as never));
  authed.route('/data-quality', createDataQualityRoutes(sql as never));
  authed.route('/quota', makeQuotaRouter(sqlFn));
  authed.route('/admin/slos', createSloAdminRoutes(sql as never));

  // Batch 6: backup-recovery, budget-management, circuit-breaker-admin, compliance-audit,
  // connector-benchmarks, cost-attribution, data-lineage, entity-reconciliation.
  authed.route('/admin/backup-recovery', makeBackupRecoveryRouter(sql));
  authed.route('/workspace', createBudgetManagementRoutes(sql));
  authed.route('/admin/connectors', createCircuitBreakerAdminRoutes(sql as never));
  authed.route('/compliance', createComplianceAuditRoutes(sql as never));
  authed.route('/connector-benchmarks', createConnectorBenchmarksRoutes(sql));
  authed.route('/cost-attribution', makeCostAttributionRouter(sql));
  authed.route('/', createDataLineageRoutes(sql));
  authed.route('/', makeEntityReconciliationRouter(sql));

  // Batch 7: batch-recommendations, connector-health-scorecards, dsr,
  // entity-change-subscriptions, entity-lifecycle, sync-optimizer.
  authed.route('/batch', makeBatchRecommendationsRouter(sql));
  authed.route('/health-scorecards', createConnectorHealthScorecardsRoutes(sql));
  authed.route('/dsr', createDsrRoutes(sql));
  authed.route('/entity-subscriptions', createEntityChangeSubscriptionsRoutes(sql));
  authed.route('/entities', makeEntityLifecycleRouter(sql));
  authed.route('/admin/lifecycle', makeLifecycleAdminRouter(sql));
  authed.route('/sync-optimizer', createSyncOptimizerRoutes(sql));

  // Batch 8: agent-feedback, context-deltas, context-summarization, context-versioning,
  // field-mappings, event-streams. Routes previously used CF-Worker SqlBindings pattern;
  // refactored to factory functions that close over sql.
  authed.route('/agents', createAgentFeedbackRoutes(sql as never));
  authed.route('/mcp-clients', createContextDeltasRoutes(sql as never));
  authed.route('/context-summarization', createContextSummarizationRoutes(sql as never));
  authed.route('/context', createContextVersioningRoutes(sql as never));
  authed.route('/connectors', createFieldMappingsRoutes(sql as never));
  authed.route('/', createEventStreamsRoutes(sql as never));

  // Batch 9: graphql, ha-admin, health-forecasts, index-repair, llm-providers,
  // mcp-resource-discovery, mcp-streaming, mcp-subscriptions.
  authed.route('/graphql', createGraphQLRoutes(sqlFn));
  authed.route('/admin/ha', makeHaAdminRouter(sql));
  authed.route('/connectors', createHealthForecastRoutes(sql));
  authed.route('/index-repair', createIndexRepairRoutes(sql));
  authed.route('/llm-providers', createLlmProviderRoutes(sqlFn));
  authed.route('/mcp', createMcpResourceDiscoveryRoutes());
  authed.route('/mcp', createMcpStreamingRoutes());
  authed.route('/mcp', createMcpSubscriptionRoutes(sql));

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
  const embeddingProvider = createDefaultProvider();
  const vectorStore = new PgvectorStore(pgUrl, embeddingProvider.getModelDimensions());
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
