import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SemanticCache } from '@iris/cache/semantic-cache';
import { PgvectorStore, GlossaryService, MetricRegistry, ContextPermissionService, PiiConfigService } from '@iris/semantic-core';
import type { VectorStore, ContextPermissions, WorkspacePiiConfig } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import { registerGracefulShutdown } from './shutdown.js';
import { registerQueryContext } from './tools/query-context.js';
import { registerListEntities } from './tools/list-entities.js';
import { registerGetEntity } from './tools/get-entity.js';
import { registerGetMetric } from './tools/get-metric.js';
import { registerListGlossary } from './tools/list-glossary.js';
import { registerSuggestContext } from './suggestions.js';
import { validateMcpApiKey, recordSessionStart, recordSessionEnd } from './auth.js';

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
 */
export function createMcpServer(
  vectorStore: VectorStore,
  semanticCache: SemanticCache,
  openAiKey: string,
  glossaryService: GlossaryService,
  metricRegistry: MetricRegistry,
  authenticatedWorkspaceId: string | null = null,
  contextPermissions: ContextPermissions | null = null,
  piiConfig: WorkspacePiiConfig | null = null,
): McpServer {
  const server = new McpServer({ name: 'iris', version: '0.0.1' });

  registerQueryContext(server, vectorStore, semanticCache, openAiKey, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerListEntities(server, vectorStore, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerGetEntity(server, vectorStore, authenticatedWorkspaceId, contextPermissions, piiConfig);
  registerGetMetric(server, metricRegistry, authenticatedWorkspaceId);
  registerListGlossary(server, glossaryService, authenticatedWorkspaceId);
  registerSuggestContext(server, authenticatedWorkspaceId);

  return server;
}

async function main(): Promise<void> {
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

  const vectorStore = new PgvectorStore(pgUrl);
  await vectorStore.initialize();

  const redis = new Redis(redisUrl);
  const semanticCache = new SemanticCache(redis);
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
  );

  const sessionId = await recordSessionStart(sql, keyId, authenticatedWorkspaceId ?? 'unauthenticated');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Iris MCP Server running on stdio', { authenticated: !!apiKey });

  registerGracefulShutdown(async () => {
    if (sessionId) await recordSessionEnd(sql, sessionId);
    await server.close();
    await vectorStore.close();
    await sql.end();
    redis.disconnect();
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
