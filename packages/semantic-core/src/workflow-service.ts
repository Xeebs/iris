import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';

import { WorkflowTemplateService, STARTER_TEMPLATES } from './workflow-templates.js';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'workflow-service' });

type SqlClient = ReturnType<typeof postgres>;

export type WorkflowCategory = 'sales' | 'finance' | 'ops' | 'engineering' | 'customer-success';

export type CuratedTemplate = {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  recommendedConnectors: string[];
  contextHints: string[];
  mcpCalls: Array<{ tool: string; params: Record<string, unknown> }>;
};

export type ContextPreview = {
  workflowId: string;
  suggestedContextBudget: number;
  recommendedEntityTypes: string[];
  contextHints: string[];
  estimatedTokens: number;
};

const CURATED_TEMPLATES: CuratedTemplate[] = [
  {
    id: 'sales-pipeline-review',
    name: 'Sales Pipeline Review',
    description: 'Analyze won deals, forecast next quarter, and identify at-risk accounts.',
    category: 'sales',
    recommendedConnectors: ['hubspot', 'salesforce', 'slack'],
    contextHints: ['include recent deals', 'top accounts by ARR', 'key contacts', 'pipeline stages'],
    mcpCalls: [
      { tool: 'query-context', params: { query: 'active deals in pipeline', entityTypes: ['deal', 'contact'], topK: 15 } },
      { tool: 'get-metric', params: { name: 'MRR' } },
      { tool: 'query-context', params: { query: 'at-risk accounts', entityTypes: ['company'], topK: 10 } },
    ],
  },
  {
    id: 'financial-forecast',
    name: 'Financial Forecast',
    description: 'Summarize revenue metrics, invoice status, and expense trends.',
    category: 'finance',
    recommendedConnectors: ['quickbooks', 'xero', 'stripe'],
    contextHints: ['invoices due', 'monthly revenue', 'expense categories'],
    mcpCalls: [
      { tool: 'query-context', params: { query: 'outstanding invoices', entityTypes: ['invoice'], topK: 20 } },
      { tool: 'get-metric', params: { name: 'ARR' } },
      { tool: 'get-metric', params: { name: 'MRR' } },
    ],
  },
  {
    id: 'customer-health-analysis',
    name: 'Customer Health Analysis',
    description: 'Review at-risk customers based on usage, support tickets, and activity signals.',
    category: 'customer-success',
    recommendedConnectors: ['hubspot', 'zendesk', 'intercom'],
    contextHints: ['low-engagement customers', 'open support tickets', 'NPS scores'],
    mcpCalls: [
      { tool: 'query-context', params: { query: 'customers with low engagement or support tickets', entityTypes: ['contact', 'company'], topK: 15 } },
    ],
  },
  {
    id: 'project-planning',
    name: 'Project Planning',
    description: 'Gather resource availability, current milestones, and blockers.',
    category: 'ops',
    recommendedConnectors: ['jira', 'linear', 'asana'],
    contextHints: ['open tasks', 'upcoming milestones', 'blocked items', 'team capacity'],
    mcpCalls: [
      { tool: 'query-context', params: { query: 'open tasks and blockers', entityTypes: ['task', 'project'], topK: 20 } },
    ],
  },
  {
    id: 'resource-allocation',
    name: 'Resource Allocation',
    description: 'Analyze team capacity and optimize assignment across projects.',
    category: 'engineering',
    recommendedConnectors: ['jira', 'github', 'linear'],
    contextHints: ['open PRs', 'sprint capacity', 'engineer assignments', 'tech debt items'],
    mcpCalls: [
      { tool: 'query-context', params: { query: 'engineer workload and assignments', entityTypes: ['task', 'person'], topK: 15 } },
    ],
  },
];

/**
 * Higher-level workflow service for template instantiation and context optimization.
 * Wraps WorkflowTemplateService with curated template support.
 */
export class WorkflowService {
  private readonly templateSvc: WorkflowTemplateService;

  constructor(private readonly sql: SqlClient) {
    this.templateSvc = new WorkflowTemplateService(sql);
  }

  /**
   * List all curated templates grouped by category.
   */
  listCuratedTemplates(): CuratedTemplate[] {
    return CURATED_TEMPLATES;
  }

  /**
   * Instantiate a curated template into a workspace.
   * Clones the template's MCP calls and context hints into a user-owned record.
   *
   * @param workspaceId  - Target workspace
   * @param templateId   - Curated template ID (from CURATED_TEMPLATES)
   */
  async instantiateTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<Result<import('./workflow-templates.js').WorkflowTemplate, Error>> {
    const curated = CURATED_TEMPLATES.find((t) => t.id === templateId);
    if (!curated) return err(new Error(`Curated template "${templateId}" not found`));

    const result = await this.templateSvc.createTemplate(workspaceId, {
      templateName: curated.name,
      description: curated.description,
      triggerType: 'manual',
      triggerConfig: {},
      mcpCalls: curated.mcpCalls,
      responseFormat: 'markdown',
    });

    if (result.isOk()) {
      log.info('Curated template instantiated', { workspaceId, templateId });
    }
    return result;
  }

  /**
   * Generate a context preview for an existing workflow template.
   * Analyzes MCP calls to recommend context budget and entity type hints.
   *
   * @param workspaceId - Target workspace
   * @param workflowId  - Workflow template ID
   */
  async optimizeContextForWorkflow(
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<ContextPreview, Error>> {
    const templateResult = await this.templateSvc.getTemplate(workspaceId, workflowId);
    if (templateResult.isErr()) return err(templateResult.error);
    if (!templateResult.value) return err(new Error('Workflow not found'));

    const template = templateResult.value;
    const entityTypes = new Set<string>();
    let topKTotal = 0;
    const contextHints: string[] = [];

    for (const call of template.mcpCalls) {
      const p = call.params as Record<string, unknown>;
      if (Array.isArray(p['entityTypes'])) {
        (p['entityTypes'] as string[]).forEach((t) => entityTypes.add(t));
      }
      if (typeof p['topK'] === 'number') topKTotal += p['topK'];
      if (typeof p['query'] === 'string') contextHints.push(p['query']);
    }

    const entityCount = entityTypes.size;
    const suggestedBudget = Math.min(8000, Math.max(2000, (topKTotal || 10) * 150 + entityCount * 100));
    const estimatedTokens = Math.round(suggestedBudget * 0.75);

    log.info('Context optimized for workflow', { workspaceId, workflowId, suggestedBudget });
    return ok({
      workflowId,
      suggestedContextBudget: suggestedBudget,
      recommendedEntityTypes: Array.from(entityTypes),
      contextHints,
      estimatedTokens,
    });
  }

  /**
   * Seed a new workspace with starter templates (manual trigger, no scheduled jobs).
   *
   * @param workspaceId - Target workspace
   */
  async seedStarterTemplates(workspaceId: string): Promise<Result<void, Error>> {
    const errors: Error[] = [];
    for (const tpl of STARTER_TEMPLATES) {
      const result = await this.templateSvc.createTemplate(workspaceId, {
        templateName: tpl.templateName,
        description: tpl.description,
        triggerType: tpl.triggerType,
        triggerConfig: tpl.triggerConfig as Record<string, unknown>,
        mcpCalls: tpl.mcpCalls,
        responseFormat: tpl.responseFormat,
      });
      if (result.isErr()) errors.push(result.error);
    }
    if (errors.length > 0) {
      log.warn('Some starter templates failed to seed', { workspaceId, count: errors.length });
    }
    return ok(undefined);
  }
}
