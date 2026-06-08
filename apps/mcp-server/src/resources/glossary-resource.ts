import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type postgres from 'postgres';
import { GlossaryService } from '@iris/semantic-core/glossary';
import { logger } from '@iris/core/logger';

const log = logger.child({ resource: 'glossary' });

/**
 * Register the glossary:// resource template on an McpServer.
 * URI pattern: `glossary://{workspaceId}`
 *
 * Returns all approved glossary terms for the workspace as a JSON array.
 *
 * @param server - MCP server to register on
 * @param sql    - Postgres tagged-template SQL client
 */
export function registerGlossaryResource(server: McpServer, sql: ReturnType<typeof postgres>): void {
  const template = new ResourceTemplate('glossary://{workspaceId}', {
    list: undefined,
  });

  server.resource(
    'glossary',
    template,
    {
      description: 'Retrieve all approved business glossary terms for a workspace.',
      mimeType: 'application/json',
    },
    async (uri, { workspaceId }) => {
      const wsId = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;

      if (!wsId) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: 'text/plain', text: 'Missing workspaceId in URI' },
          ],
        };
      }

      log.debug('Reading glossary resource', { workspaceId: wsId });

      const service = new GlossaryService(sql);
      const result = await service.listTerms(wsId, undefined, 'approved');

      if (result.isErr()) {
        log.error('Failed to load glossary terms', { workspaceId: wsId, error: result.error.message });
        return {
          contents: [
            { uri: uri.toString(), mimeType: 'text/plain', text: `Error loading glossary: ${result.error.message}` },
          ],
        };
      }

      const payload = {
        workspaceId: wsId,
        terms: result.value.map((t) => ({
          term: t.term,
          definition: t.definition,
          exampleValue: t.exampleValue,
          usageCount: t.usageCount,
          approvedAt: t.approvedAt?.toISOString() ?? null,
        })),
        totalTerms: result.value.length,
        retrievedAt: new Date().toISOString(),
      };

      return {
        contents: [
          {
            uri: `glossary://${wsId}`,
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
