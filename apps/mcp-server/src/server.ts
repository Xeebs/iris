import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SemanticCache } from '@iris/cache/semantic-cache';
import { PgvectorStore } from '@iris/semantic-core';
import type { VectorStore } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';
import Redis from 'ioredis';

import { registerQueryContext } from './tools/query-context.js';
import { registerListEntities } from './tools/list-entities.js';
import { registerGetEntity } from './tools/get-entity.js';
import { registerGetMetric } from './tools/get-metric.js';
import { registerListGlossary } from './tools/list-glossary.js';

const log = logger.child({ service: 'mcp-server' });

/**
 * Build and return a fully wired McpServer.
 * Exported for testability — tests can pass mock services via the returned server.
 *
 * @param vectorStore  - Initialized VectorStore
 * @param semanticCache - Initialized SemanticCache
 * @param openAiKey    - OpenAI API key for query embeddings
 */
export function createMcpServer(
  vectorStore: VectorStore,
  semanticCache: SemanticCache,
  openAiKey: string,
): McpServer {
  const server = new McpServer({ name: 'iris', version: '0.0.1' });

  registerQueryContext(server, vectorStore, semanticCache, openAiKey);
  registerListEntities(server, vectorStore);
  registerGetEntity(server, vectorStore);
  registerGetMetric(server);
  registerListGlossary(server);

  return server;
}

async function main(): Promise<void> {
  const pgUrl = process.env['DATABASE_URL'];
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const openAiKey = process.env['OPENAI_API_KEY'] ?? '';

  if (!pgUrl) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  const vectorStore = new PgvectorStore(pgUrl);
  await vectorStore.initialize();

  const redis = new Redis(redisUrl);
  const semanticCache = new SemanticCache(redis);

  const server = createMcpServer(vectorStore, semanticCache, openAiKey);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Iris MCP Server running on stdio');

  process.on('SIGINT', async () => {
    await server.close();
    await vectorStore.close();
    redis.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err });
  process.exit(1);
});
