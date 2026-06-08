import { Hono } from 'hono';
import type postgres from 'postgres';

type ToolSchema = {
  name: string;
  description: string;
  inputFields: { name: string; type: string; required: boolean; description?: string }[];
  examples: { description: string; input: Record<string, unknown> }[];
};

const REGISTERED_TOOLS: ToolSchema[] = [
  {
    name: 'query-context',
    description: 'Retrieve contextual entities and data matching a natural language query.',
    inputFields: [
      { name: 'query', type: 'string', required: true, description: 'Natural language search query' },
      { name: 'contextBudget', type: 'number', required: false, description: 'Max tokens to return (default 2000)' },
      { name: 'workspaceId', type: 'string', required: false },
    ],
    examples: [
      { description: 'Find contacts at Acme Corp', input: { query: 'contacts at Acme Corp', contextBudget: 1000 } },
    ],
  },
  {
    name: 'list-entities',
    description: 'List entities by type with optional filters.',
    inputFields: [
      { name: 'type', type: 'string', required: false },
      { name: 'limit', type: 'number', required: false },
      { name: 'workspaceId', type: 'string', required: false },
    ],
    examples: [{ description: 'List all contacts', input: { type: 'contact', limit: 20 } }],
  },
  {
    name: 'get-entity',
    description: 'Retrieve a single entity by ID.',
    inputFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'workspaceId', type: 'string', required: false },
    ],
    examples: [{ description: 'Get a specific contact', input: { id: 'hubspot:contact:123' } }],
  },
  {
    name: 'get-metric',
    description: 'Retrieve a named business metric with its current value.',
    inputFields: [
      { name: 'name', type: 'string', required: true },
      { name: 'workspaceId', type: 'string', required: false },
    ],
    examples: [{ description: 'Get MRR metric', input: { name: 'mrr' } }],
  },
  {
    name: 'bulk-entity-update',
    description: 'Update attributes on multiple entities matching a filter.',
    inputFields: [
      { name: 'filter', type: 'object', required: true, description: '{ type?, labelContains?, workspaceId }' },
      { name: 'patch', type: 'object', required: true, description: 'Attributes to merge into matching entities' },
      { name: 'dryRun', type: 'boolean', required: false },
    ],
    examples: [
      { description: 'Tag all leads as reviewed', input: { filter: { type: 'lead', workspaceId: 'ws1' }, patch: { reviewed: true }, dryRun: false } },
    ],
  },
  {
    name: 'entity-trend-analysis',
    description: 'Analyze metric trends over a time window with period-over-period comparison.',
    inputFields: [
      { name: 'metricName', type: 'string', required: true },
      { name: 'windowDays', type: 'number', required: false },
      { name: 'granularity', type: 'string', required: false, description: 'day | week | month' },
    ],
    examples: [
      { description: 'MRR trend over 30 days', input: { metricName: 'mrr', windowDays: 30, granularity: 'week' } },
    ],
  },
  {
    name: 'detect-anomalies',
    description: 'Detect statistical anomalies in metric values over time.',
    inputFields: [
      { name: 'metricName', type: 'string', required: true },
      { name: 'workspaceId', type: 'string', required: false },
    ],
    examples: [{ description: 'Detect churn rate anomalies', input: { metricName: 'churn_rate' } }],
  },
  {
    name: 'streaming-context',
    description: 'Stream context entities as SSE chunks for large result sets.',
    inputFields: [
      { name: 'query', type: 'string', required: true },
      { name: 'maxTokensPerChunk', type: 'number', required: false },
    ],
    examples: [{ description: 'Stream all deal entities', input: { query: 'all open deals', maxTokensPerChunk: 500 } }],
  },
];

export function makeMcpToolDiscoveryRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();

  app.get('/', async (c) => {
    const search = c.req.query('search')?.toLowerCase();
    const tools = search
      ? REGISTERED_TOOLS.filter((t) => t.name.includes(search) || t.description.toLowerCase().includes(search))
      : REGISTERED_TOOLS;
    return c.json({ data: tools, meta: { total: tools.length } });
  });

  app.get('/:name/usage-stats', async (c) => {
    const toolName = c.req.param('name');
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    try {
      type StatRow = { invocation_count: number; avg_latency_ms: number; error_count: number };
      const [stats] = await sql<StatRow[]>`
        SELECT COUNT(*) AS invocation_count,
               AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) AS avg_latency_ms,
               SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count
        FROM mcp_audit_log
        WHERE tool_name = ${toolName} AND workspace_id = ${workspaceId}
      `.catch(() => [{ invocation_count: 0, avg_latency_ms: null, error_count: 0 }]);
      return c.json({
        data: {
          toolName,
          invocationCount: Number(stats?.invocation_count ?? 0),
          avgLatencyMs: stats?.avg_latency_ms ? Math.round(Number(stats.avg_latency_ms)) : null,
          errorCount: Number(stats?.error_count ?? 0),
        },
      });
    } catch {
      return c.json({ data: { toolName, invocationCount: 0, avgLatencyMs: null, errorCount: 0 } });
    }
  });

  app.get('/:name/examples', async (c) => {
    const toolName = c.req.param('name');
    const tool = REGISTERED_TOOLS.find((t) => t.name === toolName);
    if (!tool) return c.json({ error: { code: 'NOT_FOUND', message: `Tool ${toolName} not found` } }, 404);
    return c.json({ data: tool.examples });
  });

  return app;
}
