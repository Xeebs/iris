import { Hono } from 'hono';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-resource-discovery' });

type ResourceTypeDescriptor = {
  type: string;
  uriPattern: string;
  sampleUri: string;
  description: string;
  mimeType: string;
  rateLimit: string;
};

const RESOURCE_TYPES: ResourceTypeDescriptor[] = [
  {
    type: 'entity',
    uriPattern: 'entity://{workspaceId}/{entityId}',
    sampleUri: 'entity://ws_abc123/hubspot:contact:42',
    description:
      'Retrieve a full Semantic Entity by its globally unique ID, including all attributes, relationships, and metadata.',
    mimeType: 'application/json',
    rateLimit: '1000 reads/minute per workspace',
  },
  {
    type: 'document',
    uriPattern: 'document://{workspaceId}/{documentId}',
    sampleUri: 'document://ws_abc123/notion:page:a1b2c3',
    description:
      'Read an indexed document by its ID. Documents are stored as entities with type=document; content is returned as plain text.',
    mimeType: 'text/plain',
    rateLimit: '500 reads/minute per workspace',
  },
  {
    type: 'entity-graph',
    uriPattern: 'graph://{workspaceId}/{entityId}?depth={1|2}',
    sampleUri: 'graph://ws_abc123/hubspot:contact:42?depth=2',
    description:
      'Retrieve an entity and its N-hop related entities as a JSON graph. Depth is clamped to 2. Useful for understanding entity relationships.',
    mimeType: 'application/json',
    rateLimit: '200 reads/minute per workspace',
  },
  {
    type: 'glossary',
    uriPattern: 'glossary://{workspaceId}',
    sampleUri: 'glossary://ws_abc123',
    description:
      'Retrieve all approved business glossary terms and definitions for a workspace. Useful as static system-level context in Claude/ChatGPT prompts.',
    mimeType: 'application/json',
    rateLimit: '100 reads/minute per workspace',
  },
];

/**
 * @returns Hono router exposing GET /mcp/resources for resource type discovery
 */
export function createMcpResourceDiscoveryRoutes(): Hono {
  const router = new Hono();

  router.get('/resources', (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'your_workspace_id';
    log.info('MCP resource discovery requested', { workspaceId });

    const hydratedTypes = RESOURCE_TYPES.map((rt) => ({
      ...rt,
      sampleUri: rt.sampleUri.replace('ws_abc123', workspaceId),
    }));

    return c.json({
      data: {
        resourceTypes: hydratedTypes,
        totalTypes: hydratedTypes.length,
        note: 'Access MCP resources directly from Claude or any MCP-compatible AI tool using these URI patterns.',
      },
    });
  });

  return router;
}
