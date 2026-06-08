import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import mockEntities from './fixtures/mock-entities.json';

// ─── Global mocks ─────────────────────────────────────────────────────────────

const mockRetrieveContext = vi.fn();
const mockCompress = vi.fn().mockReturnValue({ content: 'compressed context', truncated: false, savedTokens: 10 });

vi.mock('@iris/semantic-core', () => ({
  retrieveContext: (...args: unknown[]) => mockRetrieveContext(...args),
  VectorStore: vi.fn(() => ({})),
}));

vi.mock('@iris/compression', () => ({
  compress: (...args: unknown[]) => mockCompress(...args),
  serializeEntity: vi.fn((e: { label: string }) => e.label),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

// advanced-query-engine mocks
const mockParseAdvancedQuery = vi.fn().mockReturnValue({ entityType: undefined, filters: [] });
const mockApplyFilters = vi.fn((entities: unknown[]) => entities);
const mockExecuteAggregation = vi.fn().mockReturnValue({ groups: [], totalCount: 0 });
const mockFormatAggregationResult = vi.fn().mockReturnValue('aggregation result text');
const mockChainQueries = vi.fn();

vi.mock('@iris/semantic-core/advanced-query-engine', () => ({
  parseAdvancedQuery: (...args: unknown[]) => mockParseAdvancedQuery(...args),
  applyFilters: (...args: unknown[]) => mockApplyFilters(...args),
  executeAggregation: (...args: unknown[]) => mockExecuteAggregation(...args),
  formatAggregationResult: (...args: unknown[]) => mockFormatAggregationResult(...args),
  chainQueries: (...args: unknown[]) => mockChainQueries(...args),
}));

// metrics-anomaly-detector mock
const mockDetectAnomalies = vi.fn();
const mockForecastMetricValue = vi.fn();

vi.mock('@iris/semantic-core/metrics-anomaly-detector', () => ({
  MetricsAnomalyDetector: vi.fn(() => ({
    detectAnomalies: (...args: unknown[]) => mockDetectAnomalies(...args),
    forecastMetricValue: (...args: unknown[]) => mockForecastMetricValue(...args),
  })),
}));

// context-versioner mock
const mockQueryAsOfDate = vi.fn();

vi.mock('@iris/semantic-core/context-versioner', () => ({
  queryAsOfDate: (...args: unknown[]) => mockQueryAsOfDate(...args),
}));

// federation-manager mock
const mockQueryFederatedContext = vi.fn();
const mockMergeFederatedResults = vi.fn();

vi.mock('@iris/semantic-core/federation-manager', () => ({
  queryFederatedContext: (...args: unknown[]) => mockQueryFederatedContext(...args),
  mergeFederatedResults: (...args: unknown[]) => mockMergeFederatedResults(...args),
}));

// ─── Mock MCP server factory ──────────────────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function makeMockServer(): {
  server: McpServer;
  getHandler: (name: string) => ToolHandler;
} {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    tool: vi.fn((name: string, _desc: unknown, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: (name: string) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`Tool "${name}" not registered`);
      return h;
    },
  };
}

function makeMockVectorStore() {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  };
}

function makeMockSql(returnValue: unknown[] = []) {
  return vi.fn().mockResolvedValue(returnValue);
}

// ─── advanced-query-context ───────────────────────────────────────────────────

describe('advanced-query-context tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;
  let vectorStore: ReturnType<typeof makeMockVectorStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCompress.mockReturnValue({ content: 'compressed context', truncated: false, savedTokens: 10 });
    mockParseAdvancedQuery.mockReturnValue({ entityType: undefined, filters: [] });
    mockApplyFilters.mockImplementation((entities: unknown[]) => entities);
    mockRetrieveContext.mockResolvedValue({ entities: mockEntities.slice(0, 2) });

    vectorStore = makeMockVectorStore();
    ({ server, getHandler } = makeMockServer());

    const { registerAdvancedQueryContext } = await import('../tools/advanced-query-context.js');
    registerAdvancedQueryContext(server, vectorStore as never, 'test-key');
  });

  it('registers the tool', () => {
    expect(server.registerTool).toHaveBeenCalledWith(
      'advanced-query-context',
      expect.objectContaining({ title: 'Advanced Query Context' }),
      expect.any(Function),
    );
  });

  it('returns compressed context for basic query', async () => {
    const handler = getHandler('advanced-query-context');
    const result = await handler({ query: 'show me SaaS contacts', workspaceId: 'ws1', topK: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('compressed context');
    expect(result.isError).toBeFalsy();
  });

  it('returns aggregation result when aggregate param provided', async () => {
    mockExecuteAggregation.mockReturnValue({ groups: [{ groupValue: 'SaaS', count: 2 }], totalCount: 2 });
    mockFormatAggregationResult.mockReturnValue('contact count by industry: SaaS=2');

    const handler = getHandler('advanced-query-context');
    const result = await handler({
      query: 'contacts by industry',
      workspaceId: 'ws1',
      aggregate: { op: 'count', groupBy: 'industry' },
      topK: 10,
      contextBudget: 2000,
    });
    expect(result.content[0]?.text).toContain('contact count by industry');
    expect(result.isError).toBeFalsy();
  });

  it('applies explicit filters and shows filter summary', async () => {
    const filtered = [mockEntities[0]!];
    mockApplyFilters.mockReturnValue(filtered);

    const handler = getHandler('advanced-query-context');
    const result = await handler({
      query: 'SaaS contacts',
      workspaceId: 'ws1',
      filters: [{ field: 'industry', op: '=', value: 'SaaS' }],
      topK: 10,
      contextBudget: 2000,
    });
    expect(mockApplyFilters).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });

  it('executes chained query and returns combined summary', async () => {
    mockChainQueries.mockResolvedValue({
      firstQueryEntities: [mockEntities[0]!],
      chainedEntities: [mockEntities[1]!],
      combined: mockEntities.slice(0, 2),
    });

    const handler = getHandler('advanced-query-context');
    const result = await handler({
      query: 'SaaS contacts',
      workspaceId: 'ws1',
      chainedQuery: 'their companies',
      topK: 10,
      contextBudget: 2000,
    });
    expect(result.content[0]?.text).toContain('Step 1');
    expect(result.content[0]?.text).toContain('Step 2');
    expect(result.isError).toBeFalsy();
  });

  it('blocks cross-workspace access when auth workspace is set', async () => {
    const { registerAdvancedQueryContext } = await import('../tools/advanced-query-context.js');
    const { server: s, getHandler: gh } = makeMockServer();
    registerAdvancedQueryContext(s, vectorStore as never, 'test-key', 'ws-auth');
    const handler = gh('advanced-query-context');
    const result = await handler({ query: 'contacts', workspaceId: 'ws-other', topK: 10, contextBudget: 2000 });
    expect(result.content[0]?.text).toContain('Access denied');
  });

  it('returns error content when retrieval throws', async () => {
    mockRetrieveContext.mockRejectedValue(new Error('vector store unavailable'));
    const handler = getHandler('advanced-query-context');
    const result = await handler({ query: 'contacts', workspaceId: 'ws1', topK: 10, contextBudget: 2000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('vector store unavailable');
  });
});

// ─── detect-anomalies ─────────────────────────────────────────────────────────

describe('detectAnomalyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns anomaly summary for a metric with anomalies', async () => {
    const anomalyDate = new Date('2024-03-20');
    mockDetectAnomalies.mockResolvedValue(ok([
      {
        metricId: 'monthly_revenue',
        anomalyDate,
        observedValue: 50000,
        expectedValue: 125000,
        zScore: -3.2,
        severity: 'critical',
        acknowledgedAt: null,
      },
    ]));

    const { detectAnomalyTool } = await import('../tools/detect-anomalies.js');
    const result = await detectAnomalyTool(
      { metricId: 'monthly_revenue', lookbackDays: 30, sensitivity: 'medium', includeForecast: false },
      makeMockSql() as never,
    );

    expect(result.isOk()).toBe(true);
    const text = result.value.content[0]!.text;
    expect(text).toContain('monthly_revenue');
    expect(text).toContain('CRITICAL');
    expect(text).toContain('z=');
  });

  it('returns "no anomalies" when none detected', async () => {
    mockDetectAnomalies.mockResolvedValue(ok([]));

    const { detectAnomalyTool } = await import('../tools/detect-anomalies.js');
    const result = await detectAnomalyTool(
      { metricId: 'churn_rate', lookbackDays: 7, sensitivity: 'low', includeForecast: false },
      makeMockSql() as never,
    );

    expect(result.isOk()).toBe(true);
    expect(result.value.content[0]!.text).toContain('No anomalies detected');
  });

  it('includes forecast when includeForecast is true', async () => {
    mockDetectAnomalies.mockResolvedValue(ok([]));
    mockForecastMetricValue.mockResolvedValue(ok([
      { date: new Date('2024-04-01'), forecastedValue: 130000, trend: 'up' },
      { date: new Date('2024-04-02'), forecastedValue: 135000, trend: 'up' },
    ]));

    const { detectAnomalyTool } = await import('../tools/detect-anomalies.js');
    const result = await detectAnomalyTool(
      { metricId: 'monthly_revenue', lookbackDays: 30, sensitivity: 'medium', includeForecast: true },
      makeMockSql() as never,
    );

    expect(result.isOk()).toBe(true);
    const text = result.value.content[0]!.text;
    expect(text).toContain('7-Day Forecast');
    expect(text).toContain('↑');
  });

  it('returns structured error when detector fails', async () => {
    mockDetectAnomalies.mockResolvedValue(err(new Error('DB unavailable')));

    const { detectAnomalyTool } = await import('../tools/detect-anomalies.js');
    const result = await detectAnomalyTool(
      { metricId: 'bad_metric', lookbackDays: 30, sensitivity: 'medium', includeForecast: false },
      makeMockSql() as never,
    );

    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.value.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('Anomaly detection failed');
  });

  it('handles invalid input gracefully', async () => {
    const { detectAnomalyTool } = await import('../tools/detect-anomalies.js');
    const result = await detectAnomalyTool(
      { metricId: '', lookbackDays: 30, sensitivity: 'medium', includeForecast: false },
      makeMockSql() as never,
    );

    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.value.content[0]!.text) as { error: string };
    expect(parsed.error).toBe('Invalid input');
  });
});

// ─── query-context-at-date ────────────────────────────────────────────────────

describe('query-context-at-date tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;
  const mockSql = makeMockSql();

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, getHandler } = makeMockServer());

    const { registerQueryContextAtDateTool } = await import('../tools/query-context-at-date.js');
    registerQueryContextAtDateTool(server, { sql: mockSql as never });
  });

  it('registers the tool via server.tool()', () => {
    expect((server as unknown as { tool: ReturnType<typeof vi.fn> }).tool).toHaveBeenCalledWith(
      'query-context-at-date',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns historical context for a valid date', async () => {
    mockQueryAsOfDate.mockResolvedValue(ok({
      entities: [{ id: 'c1', label: 'Alice', type: 'contact' }],
      snapshotDate: '2024-01-01T00:00:00.000Z',
      tokenCount: 50,
    }));

    const handler = getHandler('query-context-at-date');
    const result = await handler({
      query: 'active customers',
      workspaceId: 'ws1',
      targetDate: '2024-01-01T00:00:00.000Z',
      contextBudget: 2000,
    });

    expect(result.content[0]?.text).toContain('Alice');
    expect(result.isError).toBeFalsy();
  });

  it('returns error JSON when queryAsOfDate fails', async () => {
    mockQueryAsOfDate.mockResolvedValue(err(new Error('snapshot not found')));

    const handler = getHandler('query-context-at-date');
    const result = await handler({
      query: 'contacts',
      workspaceId: 'ws1',
      targetDate: '2020-01-01T00:00:00.000Z',
      contextBudget: 2000,
    });

    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('snapshot not found');
  });
});

// ─── query-federated-context ──────────────────────────────────────────────────

describe('query-federated-context tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;
  const mockSql = makeMockSql();

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, getHandler } = makeMockServer());

    const { registerQueryFederatedContextTool } = await import('../tools/query-federated-context.js');
    registerQueryFederatedContextTool(server, { sql: mockSql as never });
  });

  it('registers the tool via server.tool()', () => {
    expect((server as unknown as { tool: ReturnType<typeof vi.fn> }).tool).toHaveBeenCalledWith(
      'query-federated-context',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns merged federated results', async () => {
    mockQueryFederatedContext.mockResolvedValue(ok({
      entities: [mockEntities[0]!, mockEntities[1]!],
      queriedWorkspaces: ['ws1', 'ws2'],
      permissionDenied: [],
    }));
    mockMergeFederatedResults.mockReturnValue({
      entities: [mockEntities[0]!, mockEntities[1]!],
      tokenCount: 80,
      truncated: false,
    });

    const handler = getHandler('query-federated-context');
    const result = await handler({
      query: 'SaaS contacts',
      workspaceId: 'ws1',
      federatedWorkspaceIds: ['ws2'],
      maxTokenBudget: 2000,
    });

    const parsed = JSON.parse(result.content[0]!.text) as {
      entities: unknown[];
      queriedWorkspaces: string[];
      truncated: boolean;
    };
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.queriedWorkspaces).toContain('ws2');
    expect(parsed.truncated).toBe(false);
  });

  it('surfaces permissionDenied workspaces in response', async () => {
    mockQueryFederatedContext.mockResolvedValue(ok({
      entities: [],
      queriedWorkspaces: ['ws1'],
      permissionDenied: ['ws-restricted'],
    }));
    mockMergeFederatedResults.mockReturnValue({ entities: [], tokenCount: 0, truncated: false });

    const handler = getHandler('query-federated-context');
    const result = await handler({
      query: 'contacts',
      workspaceId: 'ws1',
      federatedWorkspaceIds: ['ws-restricted'],
      maxTokenBudget: 2000,
    });

    const parsed = JSON.parse(result.content[0]!.text) as { permissionDenied: string[] };
    expect(parsed.permissionDenied).toContain('ws-restricted');
  });

  it('returns error JSON when queryFederatedContext fails', async () => {
    mockQueryFederatedContext.mockResolvedValue(err(new Error('federation service down')));

    const handler = getHandler('query-federated-context');
    const result = await handler({
      query: 'contacts',
      workspaceId: 'ws1',
      federatedWorkspaceIds: ['ws2'],
      maxTokenBudget: 2000,
    });

    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('federation service down');
  });
});

// ─── auto-tool-registry ───────────────────────────────────────────────────────

describe('auto-tool-registry', () => {
  let server: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ server } = makeMockServer());
  });

  it('registers one tool per spec', async () => {
    const { registerAutoGeneratedTools } = await import('../tools/auto-tool-registry.js');
    const specs = [
      {
        toolId: 'query-hubspot-contacts',
        sourceConnectorId: 'hubspot',
        entityType: 'contact',
        description: 'Query HubSpot contacts',
        inputSchemaJson: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        toolId: 'query-hubspot-deals',
        sourceConnectorId: 'hubspot',
        entityType: 'deal',
        description: 'Query HubSpot deals',
        inputSchemaJson: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];

    registerAutoGeneratedTools(server, specs, 'ws1', 'http://localhost:3001');
    expect((server as unknown as { tool: ReturnType<typeof vi.fn> }).tool).toHaveBeenCalledTimes(2);
    expect((server as unknown as { tool: ReturnType<typeof vi.fn> }).tool).toHaveBeenCalledWith(
      'query-hubspot-contacts',
      expect.any(String),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('tool handler fetches entities from the retrieval API', async () => {
    const { registerAutoGeneratedTools } = await import('../tools/auto-tool-registry.js');
    const { server: s, getHandler } = makeMockServer();

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'c1', label: 'Alice' }] }),
    } as Response);

    registerAutoGeneratedTools(s, [{
      toolId: 'query-hubspot-contacts',
      sourceConnectorId: 'hubspot',
      entityType: 'contact',
      description: 'Query HubSpot contacts',
      inputSchemaJson: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }], 'ws1', 'http://localhost:3001');

    const handler = getHandler('query-hubspot-contacts');
    const result = await handler({ query: 'Alice' });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/entities'),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-workspace-id': 'ws1' }) }),
    );
    const parsed = JSON.parse(result.content[0]!.text) as unknown[];
    expect(parsed).toHaveLength(1);

    fetchSpy.mockRestore();
  });

  it('returns error JSON when retrieval API returns non-OK', async () => {
    const { registerAutoGeneratedTools } = await import('../tools/auto-tool-registry.js');
    const { server: s, getHandler } = makeMockServer();

    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    registerAutoGeneratedTools(s, [{
      toolId: 'query-hubspot-contacts',
      sourceConnectorId: 'hubspot',
      entityType: 'contact',
      description: 'Query HubSpot contacts',
      inputSchemaJson: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }], 'ws1', 'http://localhost:3001');

    const handler = getHandler('query-hubspot-contacts');
    const result = await handler({ query: 'something' });
    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('HTTP 500');
  });

  it('loadAutoGeneratedToolSpecs returns empty array on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    const { loadAutoGeneratedToolSpecs } = await import('../tools/auto-tool-registry.js');
    const specs = await loadAutoGeneratedToolSpecs('http://localhost:3001', 'ws1');
    expect(specs).toHaveLength(0);
  });

  it('loadAutoGeneratedToolSpecs maps API response to AutoToolSpec', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ toolId: 'tool-1', sourceConnectorId: 'hubspot', entityType: 'contact' }],
      }),
    } as Response);

    const { loadAutoGeneratedToolSpecs } = await import('../tools/auto-tool-registry.js');
    const specs = await loadAutoGeneratedToolSpecs('http://localhost:3001', 'ws1');
    expect(specs).toHaveLength(1);
    expect(specs[0]!.toolId).toBe('tool-1');
    expect(specs[0]!.sourceConnectorId).toBe('hubspot');
  });
});

// ─── streaming-context ────────────────────────────────────────────────────────

describe('streaming-context tool', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;
  let vectorStore: ReturnType<typeof makeMockVectorStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRetrieveContext.mockResolvedValue({ entities: mockEntities.slice(0, 2) });

    vectorStore = makeMockVectorStore();
    ({ server, getHandler } = makeMockServer());

    const { registerStreamingContext } = await import('../tools/streaming-context.js');
    registerStreamingContext(server, vectorStore as never, 'test-key');
  });

  it('registers streaming-context and get-context-expansion tools', () => {
    expect(server.registerTool).toHaveBeenCalledWith('streaming-context', expect.anything(), expect.any(Function));
    expect(server.registerTool).toHaveBeenCalledWith('get-context-expansion', expect.anything(), expect.any(Function));
  });

  it('returns initial summary with expansionKey', async () => {
    const handler = getHandler('streaming-context');
    const result = await handler({
      query: 'show me contacts',
      workspaceId: 'ws1',
      initialBudget: 500,
      maxBudget: 2000,
      topK: 10,
    });

    const text = result.content[0]!.text;
    expect(text).toContain('expansionKey');
    expect(result.isError).toBeFalsy();
  });

  it('expansion returns error when key is missing', async () => {
    const handler = getHandler('get-context-expansion');
    const result = await handler({
      expansionKey: 'nonexistent-key',
      workspaceId: 'ws1',
      targetLevel: 'detailed',
      additionalBudget: 1500,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not found');
  });

  it('expansion works after streaming-context returns a key', async () => {
    const streamHandler = getHandler('streaming-context');
    const streamResult = await streamHandler({
      query: 'list contacts',
      workspaceId: 'ws1',
      initialBudget: 500,
      maxBudget: 2000,
      topK: 10,
    });

    const text = streamResult.content[0]!.text;
    const keyMatch = /expansionKey: ([a-z0-9]+)/.exec(text);
    expect(keyMatch).not.toBeNull();
    const expansionKey = keyMatch![1]!;

    const expandHandler = getHandler('get-context-expansion');
    const expandResult = await expandHandler({
      expansionKey,
      workspaceId: 'ws1',
      targetLevel: 'detailed',
      additionalBudget: 1500,
    });
    expect(expandResult.isError).toBeFalsy();
    expect(expandResult.content[0]!.text).toContain('detailed level');
  });

  it('expansion returns error on workspace mismatch', async () => {
    const streamHandler = getHandler('streaming-context');
    const streamResult = await streamHandler({
      query: 'contacts',
      workspaceId: 'ws1',
      initialBudget: 500,
      maxBudget: 2000,
      topK: 10,
    });

    const keyMatch = /expansionKey: ([a-z0-9]+)/.exec(streamResult.content[0]!.text);
    const expansionKey = keyMatch![1]!;

    const expandHandler = getHandler('get-context-expansion');
    const result = await expandHandler({
      expansionKey,
      workspaceId: 'ws-different',
      targetLevel: 'full',
      additionalBudget: 1500,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('workspace mismatch');
  });

  it('blocks cross-workspace streaming request when auth workspace set', async () => {
    const { registerStreamingContext } = await import('../tools/streaming-context.js');
    const { server: s, getHandler: gh } = makeMockServer();
    registerStreamingContext(s, vectorStore as never, 'test-key', 'ws-auth');

    const handler = gh('streaming-context');
    const result = await handler({
      query: 'contacts',
      workspaceId: 'ws-other',
      initialBudget: 500,
      maxBudget: 2000,
      topK: 10,
    });
    expect(result.content[0]!.text).toContain('Access denied');
  });
});

// ─── aggregate-entities ───────────────────────────────────────────────────────

describe('aggregateEntitiesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns count aggregation grouped by attribute', async () => {
    const { aggregateEntitiesTool } = await import('../tools/aggregate-entities.js');
    const sqlRows = [
      { attributes: { industry: 'SaaS', arr: 120000 } },
      { attributes: { industry: 'SaaS', arr: 80000 } },
      { attributes: { industry: 'FinTech', arr: 60000 } },
    ];
    const sql = makeMockSql(sqlRows);

    const result = await aggregateEntitiesTool(
      {
        entityType: 'contact',
        groupByAttribute: 'industry',
        aggregations: ['count'],
        topK: 10,
        workspaceId: 'ws1',
        contextBudget: 2000,
      },
      sql as never,
    );

    expect(result.isOk()).toBe(true);
    expect(result.value.content[0]!.text).toContain('SaaS');
    expect(result.value.content[0]!.text).toContain('count=2');
  });

  it('applies filters before aggregating', async () => {
    const { aggregateEntitiesTool } = await import('../tools/aggregate-entities.js');
    const sql = makeMockSql([
      { attributes: { industry: 'SaaS', region: 'north' } },
      { attributes: { industry: 'FinTech', region: 'south' } },
    ]);

    const result = await aggregateEntitiesTool(
      {
        entityType: 'company',
        groupByAttribute: 'industry',
        aggregations: ['count'],
        filters: { region: 'north' },
        topK: 10,
        workspaceId: 'ws1',
        contextBudget: 2000,
      },
      sql as never,
    );

    expect(result.isOk()).toBe(true);
    const text = result.value.content[0]!.text;
    expect(text).toContain('SaaS');
    expect(text).not.toContain('FinTech');
  });

  it('returns error JSON on invalid input', async () => {
    const { aggregateEntitiesTool } = await import('../tools/aggregate-entities.js');
    const result = await aggregateEntitiesTool(
      { entityType: '', groupByAttribute: 'industry', aggregations: ['count'], topK: 10, workspaceId: 'ws1', contextBudget: 2000 },
      makeMockSql() as never,
    );
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.value.content[0]!.text) as { error: unknown };
    expect(parsed.error).toBeDefined();
  });
});

// ─── compare-entities ─────────────────────────────────────────────────────────

describe('compareEntitiesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns comparison table for two entities', async () => {
    const { compareEntitiesTool } = await import('../tools/compare-entities.js');
    const rows = [
      { entity_id: 'c1', entity_type: 'contact', label: 'Alice Smith', attributes: { industry: 'SaaS', stage: 'customer' } },
      { entity_id: 'c2', entity_type: 'contact', label: 'Bob Jones', attributes: { industry: 'FinTech', stage: 'lead' } },
    ];
    const sql = makeMockSql(rows);

    const result = await compareEntitiesTool(
      { entityIds: ['c1', 'c2'], attributes: 'all', diffHighlight: true, workspaceId: 'ws1', contextBudget: 2000 },
      sql as never,
    );

    expect(result.isOk()).toBe(true);
    const text = result.value.content[0]!.text;
    expect(text).toContain('Alice Smith');
    expect(text).toContain('Bob Jones');
    expect(text).toContain('industry');
  });

  it('returns "no entities" message when none found', async () => {
    const { compareEntitiesTool } = await import('../tools/compare-entities.js');
    const result = await compareEntitiesTool(
      { entityIds: ['missing-1', 'missing-2'], attributes: 'all', diffHighlight: false, workspaceId: 'ws1', contextBudget: 2000 },
      makeMockSql([]) as never,
    );

    expect(result.isOk()).toBe(true);
    expect(result.value.content[0]!.text).toContain('No entities found');
  });

  it('shows only differing attributes when diffHighlight is true', async () => {
    const { compareEntitiesTool } = await import('../tools/compare-entities.js');
    const rows = [
      { entity_id: 'c1', entity_type: 'contact', label: 'Alice', attributes: { stage: 'customer', industry: 'SaaS' } },
      { entity_id: 'c2', entity_type: 'contact', label: 'Bob', attributes: { stage: 'lead', industry: 'SaaS' } },
    ];

    const result = await compareEntitiesTool(
      { entityIds: ['c1', 'c2'], attributes: 'all', diffHighlight: true, workspaceId: 'ws1', contextBudget: 2000 },
      makeMockSql(rows) as never,
    );

    expect(result.isOk()).toBe(true);
    const text = result.value.content[0]!.text;
    // 'stage' differs (customer vs lead), so it appears
    expect(text).toContain('stage');
    // 'industry' is same on both — hidden diff note appears
    expect(text).toContain('matching attributes hidden');
  });
});
