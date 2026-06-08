import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VectorStore } from '@iris/semantic-core';
import { buildGraphResource } from '@iris/semantic-core/resource-builder';
import { logger } from '@iris/core/logger';

const log = logger.child({ resource: 'graph' });

/**
 * Register the graph:// resource template on an McpServer.
 * URI pattern: `graph://{workspaceId}/{entityId}`
 *
 * Returns the entity and all directly related entities as a JSON graph.
 *
 * @param server      - MCP server to register on
 * @param vectorStore - Initialized vector store
 */
export function registerGraphResource(server: McpServer, vectorStore: VectorStore): void {
  const template = new ResourceTemplate('graph://{workspaceId}/{entityId}', {
    list: undefined,
  });

  server.resource(
    'entity-graph',
    template,
    {
      description: 'Retrieve an entity and its related entities as a JSON graph (up to 2 hops).',
      mimeType: 'application/json',
    },
    async (uri, { workspaceId, entityId }) => {
      const wsId = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;
      const eId = Array.isArray(entityId) ? entityId[0] : entityId;

      if (!wsId || !eId) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: 'text/plain', text: 'Missing workspaceId or entityId in URI' },
          ],
        };
      }

      const depthParam = new URL(uri.toString()).searchParams.get('depth');
      const depth = depthParam ? Math.min(parseInt(depthParam, 10), 2) : 1;

      log.debug('Reading graph resource', { workspaceId: wsId, entityId: eId, depth });

      const resource = await buildGraphResource(eId, wsId, vectorStore, depth);
      if (!resource) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: 'text/plain', text: `Entity "${eId}" not found` },
          ],
        };
      }

      return {
        contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }],
      };
    },
  );
}
