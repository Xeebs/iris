/**
 * OpenAPI 3.0 specification for the Iris REST API.
 * Served at GET /openapi.json and rendered via Swagger UI at GET /docs.
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Iris API',
    description: 'Platform-agnostic business context intelligence layer. Indexes, semantically enriches, and serves business operational data to AI tools via MCP and REST.',
    version: '1.0.0',
    contact: { name: 'Iris Team', url: 'https://github.com/Xeebs/iris' },
  },
  servers: [{ url: '/api/v1', description: 'Current environment' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk-issued JWT. Pass as Authorization: Bearer <token>.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'Resource not found' },
              details: { description: 'Optional validation details' },
            },
          },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          hasMore: { type: 'boolean' },
          nextCursor: { type: 'string', nullable: true },
        },
      },
      ConnectorInstance: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          connectorId: { type: 'string', example: 'hubspot' },
          workspaceId: { type: 'string' },
          status: { type: 'string', enum: ['active', 'error', 'syncing'] },
          lastSyncedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      SemanticEntity: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'hubspot:contact:123' },
          type: { type: 'string', example: 'contact' },
          label: { type: 'string', example: 'Alice Smith' },
          attributes: { type: 'object', additionalProperties: {} },
          sourceId: { type: 'string' },
          lastModified: { type: 'string', format: 'date-time' },
        },
      },
      GlossaryTerm: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workspaceId: { type: 'string' },
          term: { type: 'string', example: 'ARR' },
          definition: { type: 'string', example: 'Annual Recurring Revenue' },
          category: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      WorkflowTemplate: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workspaceId: { type: 'string' },
          name: { type: 'string' },
          triggerType: { type: 'string', enum: ['scheduled', 'entity_change', 'manual'] },
          isActive: { type: 'boolean' },
          mcpCalls: { type: 'array', items: { type: 'object' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AuditRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workspaceId: { type: 'string' },
          toolName: { type: 'string' },
          query: { type: 'string', nullable: true },
          tokenEstimate: { type: 'integer' },
          cacheHit: { type: 'boolean' },
          durationMs: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    parameters: {
      workspaceId: {
        name: 'workspaceId',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Workspace tenant identifier',
      },
      cursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Opaque pagination cursor from previous response',
      },
      limit: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
        description: 'Maximum results to return',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns 200 if all dependencies (DB, Redis) are reachable; 503 otherwise.',
        security: [],
        responses: {
          200: { description: 'All systems operational' },
          503: { description: 'One or more dependencies unavailable' },
        },
      },
    },
    '/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Returns 200 when the API process is ready to serve traffic.',
        security: [],
        responses: { 200: { description: 'Ready' } },
      },
    },
    '/connectors/types': {
      get: {
        tags: ['Connectors'],
        summary: 'List connector types',
        description: 'Returns all registered connector manifests (HubSpot, Notion, Salesforce, etc.).',
        responses: {
          200: { description: 'List of connector manifests' },
        },
      },
    },
    '/connectors/types/{connectorId}': {
      get: {
        tags: ['Connectors'],
        summary: 'Get connector manifest',
        parameters: [{ name: 'connectorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Connector manifest' },
          404: { description: 'Connector type not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/connectors': {
      get: {
        tags: ['Connectors'],
        summary: 'List connector instances',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { $ref: '#/components/parameters/cursor' }, { $ref: '#/components/parameters/limit' }],
        responses: {
          200: { description: 'Paginated connector instances', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ConnectorInstance' } }, meta: { $ref: '#/components/schemas/PaginationMeta' } } } } } },
          400: { description: 'Missing workspaceId', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Connectors'],
        summary: 'Create connector instance',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspaceId', 'connectorId', 'config'], properties: { workspaceId: { type: 'string' }, connectorId: { type: 'string' }, config: { type: 'object' } } } } } },
        responses: {
          201: { description: 'Connector instance created' },
          400: { description: 'Validation error' },
          409: { description: 'Duplicate connector' },
        },
      },
    },
    '/connectors/{id}': {
      get: {
        tags: ['Connectors'],
        summary: 'Get connector instance',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'Connector instance' }, 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Connectors'],
        summary: 'Update connector config',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { workspaceId: { type: 'string' }, config: { type: 'object' } } } } } },
        responses: { 200: { description: 'Updated instance' }, 404: { description: 'Not found' } },
      },
      delete: {
        tags: ['Connectors'],
        summary: 'Delete connector instance',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/workspaceId' }],
        responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },
    '/connectors/{id}/sync': {
      post: {
        tags: ['Connectors'],
        summary: 'Trigger manual sync',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Sync enqueued' }, 404: { description: 'Not found' } },
      },
    },
    '/connectors/{id}/health': {
      get: {
        tags: ['Connectors'],
        summary: 'Get connector health',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'Health record' }, 404: { description: 'No health data' }, 503: { description: 'Health service not configured' } },
      },
    },
    '/connectors/{id}/health/retry': {
      post: {
        tags: ['Connectors'],
        summary: 'Manual retry sync',
        description: 'Enqueues a full sync retry for the connector and writes a retry event to connector_sync_logs.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspaceId'], properties: { workspaceId: { type: 'string' } } } } } },
        responses: { 202: { description: 'Retry queued' }, 404: { description: 'Instance not found' } },
      },
    },
    '/connectors/{id}/sync-logs': {
      get: {
        tags: ['Connectors'],
        summary: 'Get sync event logs',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/workspaceId' }, { $ref: '#/components/parameters/cursor' }, { $ref: '#/components/parameters/limit' }, { name: 'severity', in: 'query', schema: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] } }],
        responses: { 200: { description: 'Paginated sync log entries' } },
      },
    },
    '/entities/search': {
      post: {
        tags: ['Entities'],
        summary: 'Semantic entity search',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspaceId', 'query'], properties: { workspaceId: { type: 'string' }, query: { type: 'string' }, topK: { type: 'integer', default: 10 }, entityTypes: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'Matching entities', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/SemanticEntity' } } } } } } } },
      },
    },
    '/audit': {
      get: {
        tags: ['Audit'],
        summary: 'List audit log records',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { $ref: '#/components/parameters/cursor' }, { $ref: '#/components/parameters/limit' }],
        responses: { 200: { description: 'Audit records', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AuditRecord' } }, meta: { $ref: '#/components/schemas/PaginationMeta' } } } } } } },
      },
    },
    '/analytics/tokens': {
      get: {
        tags: ['Analytics'],
        summary: 'Token usage over time',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { name: 'days', in: 'query', schema: { type: 'integer', default: 30, maximum: 365 } }],
        responses: { 200: { description: 'Daily token analytics summary' } },
      },
    },
    '/analytics/breakdown': {
      get: {
        tags: ['Analytics'],
        summary: 'Token usage breakdown by dimension',
        description: 'Groups token_events by time bucket and tool_name for per-connector drill-down.',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { name: 'granularity', in: 'query', schema: { type: 'string', enum: ['hourly', 'daily', 'weekly', 'monthly'], default: 'daily' } }, { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['connector', 'tool'], default: 'connector' } }, { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
        responses: { 200: { description: 'Breakdown buckets with per-group token metrics' } },
      },
    },
    '/glossary': {
      get: {
        tags: ['Glossary'],
        summary: 'List glossary terms',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { $ref: '#/components/parameters/cursor' }, { $ref: '#/components/parameters/limit' }],
        responses: { 200: { description: 'Glossary terms', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/GlossaryTerm' } }, meta: { $ref: '#/components/schemas/PaginationMeta' } } } } } } },
      },
      post: {
        tags: ['Glossary'],
        summary: 'Create glossary term',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspaceId', 'term', 'definition'], properties: { workspaceId: { type: 'string' }, term: { type: 'string' }, definition: { type: 'string' }, category: { type: 'string' } } } } } },
        responses: { 201: { description: 'Term created' }, 409: { description: 'Duplicate term' } },
      },
    },
    '/workflow-templates': {
      get: {
        tags: ['Workflows'],
        summary: 'List workflow templates',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }, { name: 'activeOnly', in: 'query', schema: { type: 'boolean' } }],
        responses: { 200: { description: 'Workflow templates', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/WorkflowTemplate' } } } } } } } },
      },
      post: {
        tags: ['Workflows'],
        summary: 'Create workflow template',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['workspaceId', 'name', 'triggerType'], properties: { workspaceId: { type: 'string' }, name: { type: 'string' }, triggerType: { type: 'string', enum: ['scheduled', 'entity_change', 'manual'] }, mcpCalls: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { 201: { description: 'Template created' }, 409: { description: 'Duplicate name' } },
      },
    },
    '/workflow-templates/{id}': {
      get: {
        tags: ['Workflows'],
        summary: 'Get workflow template',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'Template' }, 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Workflows'],
        summary: 'Update workflow template',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated template' } },
      },
      delete: {
        tags: ['Workflows'],
        summary: 'Delete workflow template',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/benchmarks/settings': {
      get: {
        tags: ['Benchmarking'],
        summary: 'Get benchmarking settings',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'Settings' } },
      },
      put: {
        tags: ['Benchmarking'],
        summary: 'Update benchmarking settings',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { workspaceId: { type: 'string' }, benchmarkingEnabled: { type: 'boolean' }, industry: { type: 'string' }, companySize: { type: 'string' } } } } } },
        responses: { 200: { description: 'Updated settings' } },
      },
    },
    '/benchmarks/peer-comparison': {
      get: {
        tags: ['Benchmarking'],
        summary: 'Peer benchmark comparison',
        description: 'Returns P25/P50/P75/P90 percentile data for token savings, cache hit rate, and entity count.',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'Peer comparison data' }, 422: { description: 'No benchmark snapshot available' } },
      },
    },
    '/export/osi': {
      get: {
        tags: ['Export'],
        summary: 'Export workspace data (OSI format)',
        description: 'Downloads all indexed entities and metadata as a signed JSON export.',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'OSI export JSON', content: { 'application/json': {} } } },
      },
    },
    '/pii-config': {
      get: {
        tags: ['PII'],
        summary: 'Get PII configuration',
        parameters: [{ $ref: '#/components/parameters/workspaceId' }],
        responses: { 200: { description: 'PII masking rules by connector' } },
      },
      put: {
        tags: ['PII'],
        summary: 'Update PII configuration',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated PII config' } },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Health and readiness probes' },
    { name: 'Connectors', description: 'Connector instance management and sync lifecycle' },
    { name: 'Entities', description: 'Semantic entity search and retrieval' },
    { name: 'Audit', description: 'MCP query audit log' },
    { name: 'Analytics', description: 'Token usage and savings analytics' },
    { name: 'Glossary', description: 'Workspace business glossary' },
    { name: 'Workflows', description: 'Scheduled MCP workflow templates' },
    { name: 'Benchmarking', description: 'Cross-workspace peer benchmarks' },
    { name: 'Export', description: 'Data export in standard formats' },
    { name: 'PII', description: 'Field-level PII masking configuration' },
  ],
} as const;
