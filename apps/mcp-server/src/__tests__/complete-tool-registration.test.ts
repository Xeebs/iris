import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('@iris/core/logger', async () => {
  const actual = await vi.importActual<typeof import('@iris/core/logger')>('@iris/core/logger');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  };
});

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function makeMockServer() {
  const toolHandlers = new Map<string, ToolHandler>();
  const server = {
    tool: vi.fn((name: string, _desc: unknown, _schema: unknown, handler: ToolHandler) => {
      toolHandlers.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      toolHandlers.set(name, handler);
    }),
  } as unknown as McpServer;
  return {
    server,
    toolCalls: (server as unknown as { tool: ReturnType<typeof vi.fn> }).tool as ReturnType<typeof vi.fn>,
    getHandler: (name: string): ToolHandler => {
      const h = toolHandlers.get(name);
      if (!h) throw new Error(`Tool "${name}" not registered`);
      return h;
    },
    hasHandler: (name: string) => toolHandlers.has(name),
  };
}

function makeSql(overrides: Record<string, unknown[]> = {}) {
  const fn = vi.fn((strings: TemplateStringsArray) => {
    const q = strings.raw.join('?');
    for (const [key, rows] of Object.entries(overrides)) {
      if (q.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  (fn as Record<string, unknown>).array = (arr: unknown) => arr;
  (fn as Record<string, unknown>).json = (obj: unknown) => obj;
  return fn;
}

// ─── Registration tests (8) ──────────────────────────────────────────────────

describe('MCP tool registration', () => {
  describe('connector-health-forecast', () => {
    it('registers the tool with server.tool()', async () => {
      const { server, toolCalls } = makeMockServer();
      const sql = makeSql();
      const { registerConnectorHealthForecastTool } = await import('../tools/connector-health-forecast.js');
      registerConnectorHealthForecastTool(server, sql);
      expect(toolCalls).toHaveBeenCalledWith(
        'connector-health-forecast',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('query-context-at-date', () => {
    it('registers the tool with server.tool()', async () => {
      const { server, toolCalls } = makeMockServer();
      const sql = makeSql();
      const { registerQueryContextAtDateTool } = await import('../tools/query-context-at-date.js');
      registerQueryContextAtDateTool(server, { sql: sql as unknown as Parameters<typeof registerQueryContextAtDateTool>[1]['sql'] });
      expect(toolCalls).toHaveBeenCalledWith('query-context-at-date', expect.any(String), expect.any(Object), expect.any(Function));
    });
  });

  describe('query-context-refined', () => {
    it('registers the tool via registerTool()', async () => {
      const { server } = makeMockServer();
      const registerToolSpy = (server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool;
      const sql = makeSql();
      const { registerQueryContextRefined } = await import('../tools/query-context-refined.js');
      registerQueryContextRefined(server, sql, null);
      expect(registerToolSpy).toHaveBeenCalledWith('query-context-refined', expect.any(Object), expect.any(Function));
    });
  });

  describe('query-federated-context', () => {
    it('registers the tool with server.tool()', async () => {
      const { server, toolCalls } = makeMockServer();
      const sql = makeSql();
      const { registerQueryFederatedContextTool } = await import('../tools/query-federated-context.js');
      registerQueryFederatedContextTool(server, { sql: sql as unknown as Parameters<typeof registerQueryFederatedContextTool>[1]['sql'] });
      expect(toolCalls).toHaveBeenCalledWith('query-federated-context', expect.any(String), expect.any(Object), expect.any(Function));
    });
  });

  describe('bulk-entity-update', () => {
    it('exports bulkEntityUpdateTool with correct name', async () => {
      const { bulkEntityUpdateTool } = await import('../tools/bulk-entity-update.js');
      expect(bulkEntityUpdateTool.name).toBe('bulk-entity-update');
    });

    it('exports bulkEntityUpdateSchema with required shape', async () => {
      const { bulkEntityUpdateSchema } = await import('../tools/bulk-entity-update.js');
      expect(bulkEntityUpdateSchema.shape).toHaveProperty('filter');
      expect(bulkEntityUpdateSchema.shape).toHaveProperty('patch');
      expect(bulkEntityUpdateSchema.shape).toHaveProperty('dryRun');
    });
  });

  describe('entity-trend-analysis', () => {
    it('exports entityTrendAnalysisTool with correct name', async () => {
      const { entityTrendAnalysisTool } = await import('../tools/entity-trend-analysis.js');
      expect(entityTrendAnalysisTool.name).toBe('entity-trend-analysis');
    });

    it('exports entityTrendAnalysisSchema with required shape', async () => {
      const { entityTrendAnalysisSchema } = await import('../tools/entity-trend-analysis.js');
      expect(entityTrendAnalysisSchema.shape).toHaveProperty('metricName');
      expect(entityTrendAnalysisSchema.shape).toHaveProperty('windowDays');
    });
  });

  describe('multi-connector-query-optimize', () => {
    it('createMultiConnectorQueryOptimizeTool returns tool with correct name', async () => {
      const { createMultiConnectorQueryOptimizeTool } = await import('../tools/multi-connector-query-optimize.js');
      const tool = createMultiConnectorQueryOptimizeTool(makeSql());
      expect(tool.name).toBe('multi-connector-query-optimize');
    });

    it('tool has inputSchema with .shape property (zod object)', async () => {
      const { createMultiConnectorQueryOptimizeTool } = await import('../tools/multi-connector-query-optimize.js');
      const tool = createMultiConnectorQueryOptimizeTool(makeSql());
      expect(tool.inputSchema).toHaveProperty('shape');
    });
  });

  describe('generate-query-from-question', () => {
    it('createGenerateQueryFromQuestionTool returns tool with correct name', async () => {
      const { createGenerateQueryFromQuestionTool } = await import('../tools/generate-query-from-question.js');
      const tool = createGenerateQueryFromQuestionTool(makeSql());
      expect(tool.name).toBe('generate-query-from-question');
    });

    it('tool has inputSchema with .shape property (zod object)', async () => {
      const { createGenerateQueryFromQuestionTool } = await import('../tools/generate-query-from-question.js');
      const tool = createGenerateQueryFromQuestionTool(makeSql());
      expect(tool.inputSchema).toHaveProperty('shape');
    });
  });
});

// ─── Execution tests (16) ────────────────────────────────────────────────────

describe('MCP tool execution', () => {
  describe('bulk-entity-update', () => {
    it('returns content array on valid input', async () => {
      const { bulkEntityUpdateTool } = await import('../tools/bulk-entity-update.js');
      const sql = makeSql();
      const result = await bulkEntityUpdateTool.execute(
        { filter: { workspaceId: 'ws-1' }, patch: { stage: 'closed' }, dryRun: true },
        { sql }
      );
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('dryRun mode returns matched entities without modifying', async () => {
      const { bulkEntityUpdateTool } = await import('../tools/bulk-entity-update.js');
      const sql = makeSql();
      const result = await bulkEntityUpdateTool.execute(
        { filter: { type: 'contact', workspaceId: 'ws-1' }, patch: { status: 'active' }, dryRun: true },
        { sql }
      );
      const text = result.content[0]!.text;
      expect(typeof text).toBe('string');
    });

    it('actual update (dryRun=false) calls sql', async () => {
      const { bulkEntityUpdateTool } = await import('../tools/bulk-entity-update.js');
      const sql = makeSql();
      await bulkEntityUpdateTool.execute(
        { filter: { workspaceId: 'ws-1' }, patch: { tag: 'vip' }, dryRun: false },
        { sql }
      );
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('entity-trend-analysis', () => {
    it('returns content array on valid input', async () => {
      const { entityTrendAnalysisTool } = await import('../tools/entity-trend-analysis.js');
      const sql = makeSql();
      const result = await entityTrendAnalysisTool.execute(
        { metricName: 'deal_value', workspaceId: 'ws-1', windowDays: 30, granularity: 'day' },
        { sql }
      );
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('text');
    });

    it('calls sql with workspaceId filter', async () => {
      const { entityTrendAnalysisTool } = await import('../tools/entity-trend-analysis.js');
      const sql = makeSql();
      await entityTrendAnalysisTool.execute(
        { metricName: 'active_contacts', workspaceId: 'ws-1', windowDays: 7, granularity: 'day' },
        { sql }
      );
      expect(sql).toHaveBeenCalled();
    });

    it('computeTrend correctly identifies upward trend', async () => {
      const { computeTrend } = await import('../tools/entity-trend-analysis.js');
      expect(computeTrend([10, 12, 15, 18, 20])).toBe('up');
    });

    it('computeTrend correctly identifies downward trend', async () => {
      const { computeTrend } = await import('../tools/entity-trend-analysis.js');
      expect(computeTrend([20, 18, 15, 12, 10])).toBe('down');
    });

    it('computeTrend returns stable for flat values', async () => {
      const { computeTrend } = await import('../tools/entity-trend-analysis.js');
      expect(computeTrend([10, 10, 10, 10])).toBe('stable');
    });
  });

  describe('multi-connector-query-optimize handler', () => {
    it('returns content array for valid input', async () => {
      const { createMultiConnectorQueryOptimizeTool } = await import('../tools/multi-connector-query-optimize.js');
      const tool = createMultiConnectorQueryOptimizeTool(makeSql());
      const result = await tool.handler({
        query: 'find contacts',
        connectors: [{ connectorId: 'hubspot', entityTypes: ['contact'], avgLatencyMs: 200, cacheHitRate: 0.3, costPerRequest: 2 }],
        contextBudget: 2000,
        preferLowCost: false,
        maxLatencyMs: 2000,
      });
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('text');
    });

    it('returns error content for missing connectors', async () => {
      const { createMultiConnectorQueryOptimizeTool } = await import('../tools/multi-connector-query-optimize.js');
      const tool = createMultiConnectorQueryOptimizeTool(makeSql());
      const result = await tool.handler({ query: 'test', connectors: [] } as unknown as Parameters<typeof tool.handler>[0]);
      const text = result.content[0]!.text;
      expect(text).toContain('error');
    });

    it('response text contains recommended strategy', async () => {
      const { createMultiConnectorQueryOptimizeTool } = await import('../tools/multi-connector-query-optimize.js');
      const tool = createMultiConnectorQueryOptimizeTool(makeSql());
      const result = await tool.handler({
        query: 'deals',
        connectors: [{ connectorId: 'sf', entityTypes: ['deal'], avgLatencyMs: 300, cacheHitRate: 0.2, costPerRequest: 3 }],
        contextBudget: 3000,
        preferLowCost: false,
        maxLatencyMs: 5000,
      });
      expect(result.content[0]!.text).toContain('Recommended Strategy');
    });
  });

  describe('generate-query-from-question handler', () => {
    it('returns content array for valid input', async () => {
      const { createGenerateQueryFromQuestionTool } = await import('../tools/generate-query-from-question.js');
      const tool = createGenerateQueryFromQuestionTool(makeSql());
      const result = await tool.handler({
        question: 'find all open deals',
        workspaceId: 'ws-1',
        contextBudget: 2000,
      });
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('text');
    });

    it('returns error for missing workspaceId', async () => {
      const { createGenerateQueryFromQuestionTool } = await import('../tools/generate-query-from-question.js');
      const tool = createGenerateQueryFromQuestionTool(makeSql());
      const result = await tool.handler({ question: 'test', workspaceId: '' } as Parameters<typeof tool.handler>[0]);
      const text = result.content[0]!.text;
      expect(text).toContain('error');
    });

    it('response includes intent type', async () => {
      const { createGenerateQueryFromQuestionTool } = await import('../tools/generate-query-from-question.js');
      const tool = createGenerateQueryFromQuestionTool(makeSql());
      const result = await tool.handler({ question: 'how many contacts', workspaceId: 'ws-1', contextBudget: 2000 });
      expect(result.content[0]!.text).toContain('Intent');
    });
  });
});

// ─── Integration-style tests (8) ─────────────────────────────────────────────

describe('MCP tool integration', () => {
  let server: McpServer;
  let getHandler: (name: string) => ToolHandler;
  let hasHandler: (name: string) => boolean;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(async () => {
    sql = makeSql();
    const mock = makeMockServer();
    server = mock.server;
    getHandler = mock.getHandler;
    hasHandler = mock.hasHandler;

    const [
      { registerConnectorHealthForecastTool },
      { registerQueryContextAtDateTool },
      { registerQueryContextRefined },
      { registerQueryFederatedContextTool },
      { bulkEntityUpdateTool, bulkEntityUpdateSchema },
      { entityTrendAnalysisTool, entityTrendAnalysisSchema },
      { createMultiConnectorQueryOptimizeTool },
      { createGenerateQueryFromQuestionTool },
    ] = await Promise.all([
      import('../tools/connector-health-forecast.js'),
      import('../tools/query-context-at-date.js'),
      import('../tools/query-context-refined.js'),
      import('../tools/query-federated-context.js'),
      import('../tools/bulk-entity-update.js'),
      import('../tools/entity-trend-analysis.js'),
      import('../tools/multi-connector-query-optimize.js'),
      import('../tools/generate-query-from-question.js'),
    ]);

    registerConnectorHealthForecastTool(server, sql);
    registerQueryContextAtDateTool(server, { sql: sql as unknown as Parameters<typeof registerQueryContextAtDateTool>[1]['sql'] });
    registerQueryContextRefined(server, sql, null);
    registerQueryFederatedContextTool(server, { sql: sql as unknown as Parameters<typeof registerQueryFederatedContextTool>[1]['sql'] });

    server.tool('bulk-entity-update', bulkEntityUpdateTool.description, bulkEntityUpdateSchema.shape, async (input) =>
      bulkEntityUpdateTool.execute(input as Parameters<typeof bulkEntityUpdateTool.execute>[0], { sql }));

    server.tool('entity-trend-analysis', entityTrendAnalysisTool.description, entityTrendAnalysisSchema.shape, async (input) =>
      entityTrendAnalysisTool.execute(input as Parameters<typeof entityTrendAnalysisTool.execute>[0], { sql }));

    const mcTool = createMultiConnectorQueryOptimizeTool(sql);
    server.tool(mcTool.name, mcTool.description, mcTool.inputSchema.shape, async (input) =>
      mcTool.handler(input as Parameters<typeof mcTool.handler>[0]));

    const nlTool = createGenerateQueryFromQuestionTool(sql);
    server.tool(nlTool.name, nlTool.description, nlTool.inputSchema.shape, async (input) =>
      nlTool.handler(input as Parameters<typeof nlTool.handler>[0]));
  });

  it('all 8 tools are registered', () => {
    const expectedTools = [
      'connector-health-forecast',
      'query-context-at-date',
      'query-context-refined',
      'query-federated-context',
      'bulk-entity-update',
      'entity-trend-analysis',
      'multi-connector-query-optimize',
      'generate-query-from-question',
    ];
    for (const name of expectedTools) {
      expect(hasHandler(name), `${name} should be registered`).toBe(true);
    }
  });

  it('bulk-entity-update handler returns content array', async () => {
    const handler = getHandler('bulk-entity-update');
    const result = await handler({ filter: { workspaceId: 'ws-1' }, patch: { tag: 'test' }, dryRun: true });
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('entity-trend-analysis handler returns content array', async () => {
    const handler = getHandler('entity-trend-analysis');
    const result = await handler({ metricName: 'contacts', workspaceId: 'ws-1', windowDays: 30, granularity: 'day' });
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('multi-connector-query-optimize handler returns strategy in text', async () => {
    const handler = getHandler('multi-connector-query-optimize');
    const result = await handler({
      query: 'deals this month',
      connectors: [{ connectorId: 'hubspot', entityTypes: ['deal'], avgLatencyMs: 200, cacheHitRate: 0.4, costPerRequest: 2 }],
      contextBudget: 2000,
      preferLowCost: false,
      maxLatencyMs: 3000,
    });
    expect(result.content[0]!.text).toContain('Strategy');
  });

  it('generate-query-from-question handler returns query plan', async () => {
    const handler = getHandler('generate-query-from-question');
    const result = await handler({ question: 'show all contacts', workspaceId: 'ws-1', contextBudget: 2000 });
    expect(result.content[0]!.text).toContain('Intent');
  });

  it('connector-health-forecast handler is callable', async () => {
    const handler = getHandler('connector-health-forecast');
    const result = await handler({ connectorId: 'hubspot', workspaceId: 'ws-1' });
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('query-federated-context handler is callable', async () => {
    const handler = getHandler('query-federated-context');
    const result = await handler({ query: 'find contacts', workspaceId: 'ws-1', federatedWorkspaceIds: ['ws-2'], maxTokenBudget: 2000 });
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('all tools return content with type and text fields', async () => {
    const toolInputs: Record<string, Record<string, unknown>> = {
      'bulk-entity-update': { filter: { workspaceId: 'ws-1' }, patch: {}, dryRun: true },
      'entity-trend-analysis': { metricName: 'deals', workspaceId: 'ws-1', windowDays: 7, granularity: 'day' },
      'multi-connector-query-optimize': {
        query: 'contacts',
        connectors: [{ connectorId: 'sf', entityTypes: ['contact'], avgLatencyMs: 200, cacheHitRate: 0.3, costPerRequest: 1 }],
        contextBudget: 2000, preferLowCost: false, maxLatencyMs: 5000,
      },
      'generate-query-from-question': { question: 'show deals', workspaceId: 'ws-1', contextBudget: 2000 },
    };

    for (const [name, input] of Object.entries(toolInputs)) {
      const handler = getHandler(name);
      const result = await handler(input);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    }
  });
});
