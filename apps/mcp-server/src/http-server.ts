import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'mcp-http' });

const SERVER_CARD = {
  schema_version: '1.0',
  name: 'iris',
  version: '0.0.1',
  description: 'Business context intelligence layer — indexes and serves operational data to AI tools via MCP',
  protocol_version: '2024-11-05',
  transport: {
    type: 'stdio',
    note: 'Stdio transport is the default. Set IRIS_MCP_HTTP=true to enable StreamableHTTP on /mcp',
  },
  auth: {
    required: true,
    type: 'api_key',
    description: 'Provide IRIS_API_KEY as an environment variable; scoped to a workspace',
  },
  capabilities: {
    tools: true,
    resources: true,
    prompts: false,
    sampling: false,
  },
  tools: [
    { name: 'query-context', description: 'Semantic search over indexed business entities' },
    { name: 'advanced-query-context', description: 'Filtered entity retrieval with aggregations and chained queries' },
    { name: 'streaming-context', description: 'Stream large result sets via SSE to stay within token budgets' },
    { name: 'list-entities', description: 'List entities by type with optional workspace and permission filters' },
    { name: 'get-entity', description: 'Fetch a single entity by ID with relationship expansion' },
    { name: 'get-metric', description: 'Retrieve a named business metric with its current value and history' },
    { name: 'list-glossary', description: 'Return workspace glossary terms with definitions' },
    { name: 'aggregate-entities', description: 'Group-by and aggregate entity attributes with SQL-like semantics' },
    { name: 'compare-entities', description: 'Side-by-side comparison of two or more entities across attributes' },
    { name: 'detect-anomalies', description: 'Statistical anomaly detection over metric time series' },
    { name: 'entity-trend-analysis', description: 'Trend analysis for entity attribute changes over time' },
    { name: 'query-context-at-date', description: 'Point-in-time entity lookup as of a specific date' },
    { name: 'query-federated-context', description: 'Cross-workspace federated entity search (admin only)' },
    { name: 'bulk-entity-update', description: 'Batch update entity attributes within a workspace' },
  ],
  resources: [
    { name: 'entity://{type}/{id}', description: 'Direct entity lookup by type and ID' },
    { name: 'graph://{entity_id}', description: 'Entity relationship graph traversal' },
    { name: 'document://{document_id}', description: 'Indexed document retrieval by ID' },
    { name: 'glossary://{workspace_id}', description: 'Workspace glossary resource' },
  ],
};

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';

  if (url === '/health' || url === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'iris-mcp-server' }));
    return;
  }

  if (url === '/.well-known/mcp.json') {
    const body = JSON.stringify(SERVER_CARD, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

/**
 * Start a lightweight HTTP server alongside the stdio MCP transport.
 * Exposes /.well-known/mcp.json (Server Card) and /health.
 *
 * @param port - TCP port to listen on
 * @returns Cleanup function that shuts down the HTTP server
 */
export function startHttpSidecar(port: number): () => Promise<void> {
  const server = createServer(handleRequest);

  server.listen(port, () => {
    log.info('MCP HTTP sidecar listening', { port });
  });

  server.on('error', (err) => {
    log.error('MCP HTTP sidecar error', { error: err.message });
  });

  return () =>
    new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}
