import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SemanticCache } from '@iris/cache/semantic-cache';
import { PgvectorStore, GlossaryService, MetricRegistry } from '@iris/semantic-core';
import type { VectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import { registerQueryContext } from './tools/query-context.js';
import { registerListEntities } from './tools/list-entities.js';
import { registerGetEntity } from './tools/get-entity.js';
import { registerGetMetric } from './tools/get-metric.js';
import { registerListGlossary } from './tools/list-glossary.js';
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
 */
export function createMcpServer(
  vectorStore: VectorStore,
  semanticCache: SemanticCache,
  openAiKey: string,
  glossaryService: GlossaryService,
  metricRegistry: MetricRegistry,
  authenticatedWorkspaceId: string | null = null,
): McpServer {
  const server = new McpServer({ name: 'iris', version: '0.0.1' });

  registerQueryContext(server, vectorStore, semanticCache, openAiKey, authenticatedWorkspaceId);
  registerListEntities(server, vectorStore, authenticatedWorkspaceId);
  registerGetEntity(server, vectorStore, authenticatedWorkspaceId);
  registerGetMetric(server, metricRegistry, authenticatedWorkspaceId);
  registerListGlossary(server, glossaryService, authenticatedWorkspaceId);

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
  );

  const sessionId = await recordSessionStart(sql, keyId, authenticatedWorkspaceId ?? 'unauthenticated');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Iris MCP Server running on stdio', { authenticated: !!apiKey });

  process.on('SIGINT', async () => {
    if (sessionId) await recordSessionEnd(sql, sessionId);
    await server.close();
    await vectorStore.close();
    await sql.end();
    redis.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
