import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('../workflow-templates.js', () => ({
  WorkflowTemplateService: vi.fn(),
  STARTER_TEMPLATES: [
    {
      templateName: 'Daily Sales Summary',
      description: 'Pull top deals every morning.',
      triggerType: 'calendar',
      triggerConfig: { cron: '0 9 * * 1-5' },
      mcpCalls: [{ tool: 'query-context', params: { query: 'active deals', entityTypes: ['deal'], topK: 10 } }],
      responseFormat: 'markdown',
      isActive: true,
    },
    {
      templateName: 'Weekly Finance Review',
      description: 'Summarize invoices and revenue.',
      triggerType: 'calendar',
      triggerConfig: { cron: '0 8 * * 1' },
      mcpCalls: [{ tool: 'query-context', params: { query: 'invoices', entityTypes: ['invoice'], topK: 20 } }],
      responseFormat: 'text',
      isActive: true,
    },
  ],
}));

import { WorkflowService } from '../workflow-service.js';
import { WorkflowTemplateService } from '../workflow-templates.js';

const MockTemplateService = vi.mocked(WorkflowTemplateService);

function makeSql() {
  const fn = vi.fn().mockResolvedValue([]);
  (fn as unknown as Record<string, unknown>).array = vi.fn().mockReturnThis();
  (fn as unknown as Record<string, unknown>).json = vi.fn().mockReturnThis();
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeTemplate(id: string, workspaceId = 'ws-1') {
  return {
    id,
    workspaceId,
    templateName: 'Test Template',
    description: 'desc',
    triggerType: 'manual' as const,
    triggerConfig: {},
    mcpCalls: [
      { tool: 'query-context', params: { query: 'contacts', entityTypes: ['contact', 'deal'], topK: 15 } },
      { tool: 'get-metric', params: { name: 'MRR' } },
    ],
    responseFormat: 'markdown' as const,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── listCuratedTemplates ─────────────────────────────────────────────────────

describe('WorkflowService.listCuratedTemplates', () => {
  let service: WorkflowService;

  beforeEach(() => {
    MockTemplateService.mockImplementation(() => ({
      createTemplate: vi.fn(),
      getTemplate: vi.fn(),
      listTemplates: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
    }) as unknown as WorkflowTemplateService);
    service = new WorkflowService(makeSql());
  });

  it('returns all 5 curated templates', () => {
    const templates = service.listCuratedTemplates();
    expect(templates).toHaveLength(5);
  });

  it('includes required fields on each template', () => {
    const templates = service.listCuratedTemplates();
    for (const t of templates) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('category');
      expect(t).toHaveProperty('recommendedConnectors');
      expect(t).toHaveProperty('contextHints');
      expect(t).toHaveProperty('mcpCalls');
    }
  });

  it('returns sales-pipeline-review template with correct category', () => {
    const templates = service.listCuratedTemplates();
    const tpl = templates.find((t) => t.id === 'sales-pipeline-review');
    expect(tpl).toBeDefined();
    expect(tpl!.category).toBe('sales');
  });

  it('returns financial-forecast template with finance category', () => {
    const templates = service.listCuratedTemplates();
    const tpl = templates.find((t) => t.id === 'financial-forecast');
    expect(tpl!.category).toBe('finance');
  });

  it('returns customer-health-analysis with customer-success category', () => {
    const templates = service.listCuratedTemplates();
    const tpl = templates.find((t) => t.id === 'customer-health-analysis');
    expect(tpl!.category).toBe('customer-success');
  });

  it('returns project-planning with ops category', () => {
    const templates = service.listCuratedTemplates();
    const tpl = templates.find((t) => t.id === 'project-planning');
    expect(tpl!.category).toBe('ops');
  });

  it('returns resource-allocation with engineering category', () => {
    const templates = service.listCuratedTemplates();
    const tpl = templates.find((t) => t.id === 'resource-allocation');
    expect(tpl!.category).toBe('engineering');
  });

  it('all templates have at least one mcpCall', () => {
    const templates = service.listCuratedTemplates();
    for (const t of templates) {
      expect(t.mcpCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all templates have at least one recommendedConnector', () => {
    const templates = service.listCuratedTemplates();
    for (const t of templates) {
      expect(t.recommendedConnectors.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── instantiateTemplate ──────────────────────────────────────────────────────

describe('WorkflowService.instantiateTemplate', () => {
  let service: WorkflowService;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn();
    MockTemplateService.mockImplementation(() => ({
      createTemplate: mockCreate,
      getTemplate: vi.fn(),
      listTemplates: vi.fn(),
    }) as unknown as WorkflowTemplateService);
    service = new WorkflowService(makeSql());
  });

  it('returns err for unknown templateId', async () => {
    const result = await service.instantiateTemplate('ws-1', 'non-existent');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('non-existent');
  });

  it('calls createTemplate with correct name and description', async () => {
    mockCreate.mockResolvedValue(ok(makeTemplate('t-1')));
    await service.instantiateTemplate('ws-1', 'sales-pipeline-review');
    expect(mockCreate).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      templateName: 'Sales Pipeline Review',
      triggerType: 'manual',
      responseFormat: 'markdown',
    }));
  });

  it('returns ok with created template on success', async () => {
    const created = makeTemplate('new-1');
    mockCreate.mockResolvedValue(ok(created));
    const result = await service.instantiateTemplate('ws-1', 'financial-forecast');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(created);
  });

  it('propagates err from createTemplate', async () => {
    mockCreate.mockResolvedValue(err(new Error('DB error')));
    const result = await service.instantiateTemplate('ws-1', 'project-planning');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('DB error');
  });

  it('passes mcpCalls from curated template to createTemplate', async () => {
    mockCreate.mockResolvedValue(ok(makeTemplate('t-1')));
    await service.instantiateTemplate('ws-1', 'sales-pipeline-review');
    const callArg = mockCreate.mock.calls[0]![1];
    expect(callArg.mcpCalls).toBeDefined();
    expect(callArg.mcpCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── optimizeContextForWorkflow ───────────────────────────────────────────────

describe('WorkflowService.optimizeContextForWorkflow', () => {
  let service: WorkflowService;
  let mockGetTemplate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetTemplate = vi.fn();
    MockTemplateService.mockImplementation(() => ({
      createTemplate: vi.fn(),
      getTemplate: mockGetTemplate,
      listTemplates: vi.fn(),
    }) as unknown as WorkflowTemplateService);
    service = new WorkflowService(makeSql());
  });

  it('returns err when getTemplate returns err', async () => {
    mockGetTemplate.mockResolvedValue(err(new Error('DB down')));
    const result = await service.optimizeContextForWorkflow('ws-1', 'wf-1');
    expect(result.isErr()).toBe(true);
  });

  it('returns err when template is not found (null)', async () => {
    mockGetTemplate.mockResolvedValue(ok(null));
    const result = await service.optimizeContextForWorkflow('ws-1', 'wf-1');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns ContextPreview with correct workflowId', async () => {
    mockGetTemplate.mockResolvedValue(ok(makeTemplate('wf-1')));
    const result = await service.optimizeContextForWorkflow('ws-1', 'wf-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().workflowId).toBe('wf-1');
  });

  it('extracts entity types from mcpCalls', async () => {
    mockGetTemplate.mockResolvedValue(ok(makeTemplate('wf-1')));
    const preview = (await service.optimizeContextForWorkflow('ws-1', 'wf-1'))._unsafeUnwrap();
    expect(preview.recommendedEntityTypes).toContain('contact');
    expect(preview.recommendedEntityTypes).toContain('deal');
  });

  it('computes suggestedContextBudget ≥ 2000', async () => {
    mockGetTemplate.mockResolvedValue(ok(makeTemplate('wf-1')));
    const preview = (await service.optimizeContextForWorkflow('ws-1', 'wf-1'))._unsafeUnwrap();
    expect(preview.suggestedContextBudget).toBeGreaterThanOrEqual(2000);
  });

  it('computes suggestedContextBudget ≤ 8000', async () => {
    const template = makeTemplate('wf-1');
    template.mcpCalls = Array.from({ length: 20 }, (_, i) => ({
      tool: 'query-context',
      params: { query: `q${i}`, entityTypes: ['contact'], topK: 100 },
    }));
    mockGetTemplate.mockResolvedValue(ok(template));
    const preview = (await service.optimizeContextForWorkflow('ws-1', 'wf-1'))._unsafeUnwrap();
    expect(preview.suggestedContextBudget).toBeLessThanOrEqual(8000);
  });

  it('includes query strings in contextHints', async () => {
    mockGetTemplate.mockResolvedValue(ok(makeTemplate('wf-1')));
    const preview = (await service.optimizeContextForWorkflow('ws-1', 'wf-1'))._unsafeUnwrap();
    expect(preview.contextHints).toContain('contacts');
  });

  it('estimatedTokens is 75% of suggestedContextBudget', async () => {
    mockGetTemplate.mockResolvedValue(ok(makeTemplate('wf-1')));
    const preview = (await service.optimizeContextForWorkflow('ws-1', 'wf-1'))._unsafeUnwrap();
    expect(preview.estimatedTokens).toBe(Math.round(preview.suggestedContextBudget * 0.75));
  });
});

// ─── seedStarterTemplates ─────────────────────────────────────────────────────

describe('WorkflowService.seedStarterTemplates', () => {
  let service: WorkflowService;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn();
    MockTemplateService.mockImplementation(() => ({
      createTemplate: mockCreate,
      getTemplate: vi.fn(),
      listTemplates: vi.fn(),
    }) as unknown as WorkflowTemplateService);
    service = new WorkflowService(makeSql());
  });

  it('returns ok(undefined) on success', async () => {
    mockCreate.mockResolvedValue(ok(makeTemplate('t-1')));
    const result = await service.seedStarterTemplates('ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it('calls createTemplate for each STARTER_TEMPLATE', async () => {
    mockCreate.mockResolvedValue(ok(makeTemplate('t-1')));
    await service.seedStarterTemplates('ws-1');
    expect(mockCreate).toHaveBeenCalledTimes(2); // mocked STARTER_TEMPLATES has 2
  });

  it('returns ok even when some templates fail to seed', async () => {
    mockCreate
      .mockResolvedValueOnce(err(new Error('dup')))
      .mockResolvedValueOnce(ok(makeTemplate('t-2')));
    const result = await service.seedStarterTemplates('ws-1');
    expect(result.isOk()).toBe(true);
  });

  it('passes workspaceId to every createTemplate call', async () => {
    mockCreate.mockResolvedValue(ok(makeTemplate('t-1')));
    await service.seedStarterTemplates('ws-test');
    for (const call of mockCreate.mock.calls) {
      expect(call[0]).toBe('ws-test');
    }
  });
});
