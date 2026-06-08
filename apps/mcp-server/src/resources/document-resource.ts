import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@iris/core/logger';

const log = logger.child({ resource: 'document' });

/**
 * Register the document:// resource template on an McpServer.
 * URI pattern: `document://{workspaceId}/{documentId}`
 *
 * In the current scaffold, documents are stored as indexed entities with type=document.
 * This resource reads such entities and returns their content attribute as a text resource.
 *
 * @param server - MCP server to register on
 */
export function registerDocumentResource(server: McpServer): void {
  const template = new ResourceTemplate('document://{workspaceId}/{documentId}', {
    list: undefined,
  });

  server.resource(
    'document',
    template,
    {
      description: 'Read an indexed document by its ID. Documents are entities with type=document.',
      mimeType: 'text/plain',
    },
    async (uri, { workspaceId, documentId }) => {
      const wsId = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;
      const docId = Array.isArray(documentId) ? documentId[0] : documentId;

      if (!wsId || !docId) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: 'text/plain', text: 'Missing workspaceId or documentId in URI' },
          ],
        };
      }

      log.debug('Reading document resource', { workspaceId: wsId, documentId: docId });

      // Documents are not separately stored in the current implementation;
      // callers should use entity://{wsId}/{docId} for document-type entities.
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/plain',
            text: `Document resources are stored as entities. Use entity://${wsId}/${docId} to read document content.`,
          },
        ],
      };
    },
  );
}
