import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SemanticCache } from '@iris/cache/semantic-cache';
import { ResponseCache } from '@iris/cache/response-cache';
import { PgvectorStore, GlossaryService, MetricRegistry, ContextPermissionService, PiiConfigService } from '@iris/semantic-core';
import type { VectorStore, ContextPermissions, WorkspacePiiConfig } from '@iris/semantic-core';
import { createDefaultProvider } from '@iris/semantic-core/embedding-provider';
import { logger } from '@iris/core/logger';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import { registerGracefulShutdown } from './shutdown.js';
import { registerTool } from './register-tool.js';
import { initTelemetry, shutdownTelemetry } from './telemetry.js';
import { startHttpSidecar } from './http-server.js';
import { registerQueryContext } from './tools/query-context.js';
import { registerListEntities } from './tools/list-entities.js';
import { registerGetEntity } from './tools/get-entity.js';
import { registerGetMetric } from './tools/get-metric.js';
import { registerListGlossary } from './tools/list-glossary.js';
import { registerSuggestContext } from './suggestions.js';
import { registerAdvancedQueryContext } from './tools/advanced-query-context.js';
import { registerStreamingContext } from './tools/streaming-context.js';
import { aggregateEntitiesTool, aggregateEntitiesToolDefinition, aggregateEntitiesZodSchema } from './tools/aggregate-entities.js';
import { compareEntitiesTool, compareEntitiesToolDefinition, compareEntitiesZodSchema } from './tools/compare-entities.js';
import { detectAnomalyTool, detectAnomaliesToolDefinition, detectAnomaliesZodSchema } from './tools/detect-anomalies.js';
import { registerEntityResource } from './resources/entity-resource.js';
import { registerGraphResource } from './resources/graph-resource.js';
import { registerDocumentResource } from './resources/document-resource.js';
import { validateMcpApiKey, recordSessionStart, recordSessionEnd } from './auth.js';
import { registerConnectorHealthForecastTool } from './tools/connector-health-forecast.js';
import { registerQueryContextAtDateTool } from './tools/query-context-at-date.js';
import { registerQueryContextRefined } from './tools/query-context-refined.js';
import { registerQueryFederatedContextTool } from './tools/query-federated-context.js';
import { bulkEntityUpdateTool, bulkEntityUpdateSchema } from './tools/bulk-entity-update.js';
import { entityTrendAnalysisTool, entityTrendAnalysisSchema } from './tools/entity-trend-analysis.js';
import { createMultiConnectorQueryOptimizeTool } from './tools/multi-connector-query-optimize.js';
import { createGenerateQueryFromQuestionTool } from './tools/generate-query-from-question.js';
import { validateEmbeddingDimension } from '@iris/semantic-core/validate-embedding-dimension';

const log = logger.child({ service: 'mcp-server' });

/**
 * Build and return a fully wired McpServer.
 * Exported for testability — tests can pass mock services via the returned server.
 *
 * @param vectorStore - Initialized VectorStore
 * @param semanticCache - Initialized SemanticCache
 * @param openAiKey - OpenAI API key for query embeddings
 * @param glossaryService - GlossaryService for list-glossary tool
 * @param metricRegistry - MetricRegistry for get-metric tool
 * @param authenticatedWorkspaceId - Workspace from validated API key; null = dev/unauthenticated mode
 * @param contextPermissions - Role-based access permissions; null = unrestricted
 * @param piiConfig          - Workspace PII masking config; null = no masking applied
 * @param responseCache      - Optional response-level cache; null = no response caching
 */
type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export function createMcpServer(
  vectorStore: VectorStore,
  semanticCache: SemanticCache,
  openAiKey: string,
  glossaryService: GlossaryService,
  metricRegistry: MetricRegistry,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
  piiConfig: WorkspacePiiConfig | null = null,
  responseCache: ResponseCache | null = null,
  sql: SqlFn | null = null,
): McpServer {
  const server = new McpServer({ name: 'iris', version: '0.0.1' });

  registerQueryContext(server, vectorStore, semanticCache, openAiKey, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerListEntities(server, vectorStore, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerGetEntity(server, vectorStore, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerGetMetric(server, metricRegistry, authenticatedWorkspaceId, responseCache);
  registerListGlossary(server, glossaryService, authenticatedWorkspaceId, responseCache);
  registerSuggestContext(server, authenticatedWorkspaceId);
  registerAdvancedQueryContext(server, vectorStore, openAiKey, authenticatedWorkspaceId);
  registerStreamingContext(server, vectorStore, openAiKey, authenticatedWorkspaceId);

  if (sql) {
    const sqlFn = sql;
    registerTool(
      server,
      aggregateEntitiesToolDefinition.name,
      { description: aggregateEntitiesToolDefinition.description, inputSchema: aggregateEntitiesZodSchema.shape },
      async (input) => {
        const result = await aggregateEntitiesTool(
          { ...input, workspaceId: authenticatedWorkspaceId ?? (input as { workspaceId: string }).workspaceId } as Parameters<typeof aggregateEntitiesTool>[0],
          sqlFn
        );
        return result.isOk() ? result.value : { content: [{ type: 'text' as const, text: 'Aggregation error' }] };
      }
    );

    registerTool(
      server,
      compareEntitiesToolDefinition.name,
      { description: compareEntitiesToolDefinition.description, inputSchema: compareEntitiesZodSchema.shape },
      async (input) => {
        const result = await compareEntitiesTool(
          { ...input, workspaceId: authenticatedWorkspaceId ?? (input as { workspaceId: string }).workspaceId } as Parameters<typeof compareEntitiesTool>[0],
          sqlFn
        );
        return result.isOk() ? result.value : { content: [{ type: 'text' as const, text: 'Comparison error' }] };
      }
    );

    registerTool(
      server,
      detectAnomaliesToolDefinition.name,
      { description: detectAnomaliesToolDefinition.description, inputSchema: detectAnomaliesZodSchema.shape },
      async (input) => {
        const result = await detectAnomalyTool(input as Parameters<typeof detectAnomalyTool>[0], sqlFn);
        return result.isOk() ? result.value : { content: [{ type: 'text' as const, text: 'Detection error' }] };
      }
    );

    // Register previously unwired tools
    registerConnectorHealthForecastTool(server, sqlFn as unknown as ReturnType<typeof postgres>);
    registerQueryContextAtDateTool(server, { sql: sqlFn });
    registerQueryContextRefined(server, sqlFn as unknown as ReturnType<typeof postgres>, authenticatedWorkspaceId);
    registerQueryFederatedContextTool(server, { sql: sqlFn });

    registerTool(
      server,
      bulkEntityUpdateTool.name,
      { description: bulkEntityUpdateTool.description, inputSchema: bulkEntityUpdateSchema.shape },
      async (input) =>
        bulkEntityUpdateTool.execute(
          input as Parameters<typeof bulkEntityUpdateTool.execute>[0],
          { sql: sqlFn as unknown as ReturnType<typeof postgres> }
        )
    );

    registerTool(
      server,
      entityTrendAnalysisTool.name,
      { description: entityTrendAnalysisTool.description, inputSchema: entityTrendAnalysisSchema.shape },
      async (input) =>
        entityTrendAnalysisTool.execute(
          input as Parameters<typeof entityTrendAnalysisTool.execute>[0],
          { sql: sqlFn as unknown as ReturnType<typeof postgres> }
        )
    );

    const multiConnectorTool = createMultiConnectorQueryOptimizeTool(
      sqlFn as unknown as ReturnType<typeof postgres>
    );
    registerTool(
      server,
      multiConnectorTool.name,
      { description: multiConnectorTool.description, inputSchema: multiConnectorTool.inputSchema.shape },
      async (input) =>
        multiConnectorTool.handler(input as Parameters<typeof multiConnectorTool.handler>[0])
    );

    const nlQueryTool = createGenerateQueryFromQuestionTool(
      sqlFn as unknown as ReturnType<typeof postgres>
    );
    registerTool(
      server,
      nlQueryTool.name,
      { description: nlQueryTool.description, inputSchema: nlQueryTool.inputSchema.shape },
      async (input) =>
        nlQueryTool.handler(input as Parameters<typeof nlQueryTool.handler>[0])
    );
  }

  registerEntityResource(server, vectorStore);
  registerGraphResource(server, vectorStore);
  registerDocumentResource(server);

  return server;
}

async function main(): Promise<void> {
  initTelemetry();

  // Validate startup path so a bad .mcp.json (wrong path, relative path, missing build)
  // surfaces as a clear log entry instead of a cryptic failure in Claude Code.
  const scriptPath = process.argv[1] ?? 'unknown';
  log.info('MCP server starting', { scriptPath, cwd: process.cwd() });
  if (!scriptPath.endsWith('dist/server.js') && !scriptPath.endsWith('dist/server')) {
    log.warn(
      'MCP server started from unexpected path — expected apps/mcp-server/dist/server.js. ' +
      'Check that (1) the MCP server is built (`pnpm --filter @iris/mcp-server build`), ' +
      'and (2) .mcp.json uses the correct absolute path to dist/server.js.',
      { scriptPath }
    );
  }

  const pgUrl = process.env['DATABASE_URL'];
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const openAiKey = process.env['OPENAI_API_KEY'] ?? '';
  const apiKey = process.env['IRIS_API_KEY'] ?? null;

  if (!pgUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(pgUrl);

  let authenticatedWorkspaceId: string | null = null;
  let keyId: string | null = null;
  let contextPermissions: ContextPermissions | null = null;
  let piiConfig: WorkspacePiiConfig | null = null;

  if (apiKey) {
    const authResult = await validateMcpApiKey(apiKey, sql);
    if (authResult.isErr()) {
      log.error('Invalid IRIS_API_KEY — server refused to start', { error: authResult.error.message });
      await sql.end();
      process.exit(1);
    }
    authenticatedWorkspaceId = authResult.value.workspaceId;
    keyId = authResult.value.keyId;
    log.info('MCP server authenticated', { workspaceId: authenticatedWorkspaceId });

    if (authResult.value.roleId) {
      const permService = new ContextPermissionService(sql);
      const permResult = await permService.getPermissions(authResult.value.roleId);
      if (permResult.isOk()) {
        contextPermissions = permResult.value;
        log.info('Role-based context permissions loaded', { role: contextPermissions.role.roleName });
      } else {
        log.warn('Failed to load role permissions — proceeding without restrictions', { error: permResult.error.message });
      }
    }

    const piiService = new PiiConfigService(sql);
    const piiResult = await piiService.getConfig(authenticatedWorkspaceId);
    if (piiResult.isOk() && piiResult.value) {
      piiConfig = piiResult.value;
      log.info('PII masking config loaded', { workspaceId: authenticatedWorkspaceId, autoDetect: piiConfig.enableAutoDetection });
    }
  } else {
    log.warn('No IRIS_API_KEY set — running in unauthenticated dev mode (all workspaces accessible)');
  }

  await validateEmbeddingDimension(sql);
  const embeddingProvider = createDefaultProvider();
  const vectorStore = new PgvectorStore(pgUrl, embeddingProvider.getModelDimensions());
  await vectorStore.initialize();

  const redis = new Redis(redisUrl);
  const semanticCache = new SemanticCache(redis);
  const responseCache = new ResponseCache(redis);
  const glossaryService = new GlossaryService(sql);
  const metricRegistry = new MetricRegistry(sql);

  const server = createMcpServer(
    vectorStore,
    semanticCache,
    openAiKey,
    glossaryService,
    metricRegistry,
    authenticatedWorkspaceId,
    contextPermissions,
    piiConfig,
    responseCache,
    sql as unknown as SqlFn,
  );

  const sessionId = await recordSessionStart(sql, keyId, authenticatedWorkspaceId ?? 'unauthenticated');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Iris MCP Server running on stdio', { authenticated: !!apiKey });

  const httpPort = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : null;
  const stopHttpSidecar = httpPort ? startHttpSidecar(httpPort) : null;

  registerGracefulShutdown(async () => {
    if (sessionId) await recordSessionEnd(sql, sessionId);
    if (stopHttpSidecar) await stopHttpSidecar();
    await server.close();
    await vectorStore.close();
    await sql.end();
    redis.disconnect();
    await shutdownTelemetry();
  });
}

main().catch((err) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;
  log.error('Fatal startup error', { message: errMsg, stack: errStack });
  process.exit(1);
});
