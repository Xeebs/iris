import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'mcp-resources' });

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  entityType: z.string().optional(),
});

interface ResourceDescriptor {
  name: string;
  uriTemplate: string;
  description: string;
  mimeType: string;
  examples: string[];
}

const RESOURCE_DESCRIPTORS: ResourceDescriptor[] = [
  {
    name: 'entity',
    uriTemplate: 'entity://{workspaceId}/{entityId}',
    description: 'Retrieve a Semantic Entity by its globally unique ID.',
    mimeType: 'application/json',
    examples: [
      'entity://ws-001/hubspot:contact:1234',
      'entity://ws-001/slack:channel:C001',
    ],
  },
  {
    name: 'entity-graph',
    uriTemplate: 'graph://{workspaceId}/{entityId}',
    description: 'Retrieve an entity and its related entities as a JSON graph (up to 2 hops). Append ?depth=2 for two-hop traversal.',
    mimeType: 'application/json',
    examples: [
      'graph://ws-001/hubspot:contact:1234',
      'graph://ws-001/hubspot:deal:9999?depth=2',
    ],
  },
  {
    name: 'document',
    uriTemplate: 'document://{workspaceId}/{documentId}',
    description: 'Read an indexed document by its ID. Documents are entities with type=document.',
    mimeType: 'text/plain',
    examples: [
      'document://ws-001/notion:page:page-001',
    ],
  },
];

/**
 * Create routes for MCP resource discovery.
 * Mounted at /api/v1/mcp/resources
 */
export function createMcpResourcesRoutes(): Hono {
  const app = new Hono();

  /**
   * GET /mcp/resources — list all available MCP resource types with URI templates and examples.
   * Supports ?workspaceId for workspace-scoped examples.
   */
  app.get('/', (c) => {
    const parsed = QuerySchema.safeParse({
      workspaceId: c.req.query('workspaceId'),
      entityType: c.req.query('entityType'),
    });

    const workspaceId = parsed.success ? parsed.data.workspaceId : 'your-workspace-id';

    const resources = RESOURCE_DESCRIPTORS.map((r) => ({
      ...r,
      examples: r.examples.map((ex) => ex.replace('ws-001', workspaceId)),
    }));

    log.debug('Listed MCP resources', { workspaceId });
    return c.json({ data: resources }, 200);
  });

  /**
   * GET /mcp/resources/uri — generate a concrete URI for a resource type and IDs.
   * Query params: type (entity|entity-graph|document), workspaceId, entityId
   */
  app.get('/uri', (c) => {
    const type = c.req.query('type');
    const workspaceId = c.req.query('workspaceId');
    const entityId = c.req.query('entityId');

    if (!type || !workspaceId || !entityId) {
      return c.json({
        error: { code: 'VALIDATION_ERROR', message: 'type, workspaceId, and entityId are required' },
      }, 400);
    }

    let uri: string;
    switch (type) {
      case 'entity':
        uri = `entity://${workspaceId}/${entityId}`;
        break;
      case 'entity-graph':
        uri = `graph://${workspaceId}/${entityId}`;
        break;
      case 'document':
        uri = `document://${workspaceId}/${entityId}`;
        break;
      default:
        return c.json({
          error: { code: 'VALIDATION_ERROR', message: `Unknown resource type: ${type}` },
        }, 400);
    }

    return c.json({ data: { uri, type, workspaceId, entityId } }, 200);
  });

  return app;
}
