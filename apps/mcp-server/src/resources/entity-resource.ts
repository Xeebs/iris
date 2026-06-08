import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VectorStore } from '@iris/semantic-core';
import { buildEntityResource } from '@iris/semantic-core/resource-builder';
import { logger } from '@iris/core/logger';

const log = logger.child({ resource: 'entity' });

/**
 * Register the entity:// resource template on an McpServer.
 * URI pattern: `entity://{workspaceId}/{entityId}`
 *
 * Clients read this resource to retrieve full entity JSON by ID.
 *
 * @param server      - MCP server to register on
 * @param vectorStore - Initialized vector store
 */
export function registerEntityResource(server: McpServer, vectorStore: VectorStore): void {
  const template = new ResourceTemplate('entity://{workspaceId}/{entityId}', {
    list: undefined,
  });

  server.resource(
    'entity',
    template,
    {
      description: 'Retrieve a Semantic Entity by its globally unique ID.',
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

      log.debug('Reading entity resource', { workspaceId: wsId, entityId: eId });

      const resource = await buildEntityResource(eId, wsId, vectorStore);
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
