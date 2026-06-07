import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'workflow-templates' });

type SqlClient = ReturnType<typeof postgres>;

export type TriggerType = 'manual' | 'calendar' | 'entity_change';
export type ResponseFormat = 'text' | 'json' | 'markdown';

/** A single MCP tool call definition within a template. */
export interface McpCall {
  tool: string;
  params: Record<string, unknown>;
}

/** Trigger configuration for calendar-based or entity-change-based triggers. */
export interface TriggerConfig {
  /** For calendar triggers: cron expression (e.g. "0 9 * * 1" = Monday 9am) */
  cron?: string;
  /** For entity_change triggers: entity types to watch */
  watchEntityTypes?: string[];
}

export interface WorkflowTemplate {
  id: string;
  workspaceId: string;
  templateName: string;
  description: string;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  mcpCalls: McpCall[];
  responseFormat: ResponseFormat;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const mcpCallSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.unknown()),
});

export const createTemplateSchema = z.object({
  templateName: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  triggerType: z.enum(['manual', 'calendar', 'entity_change']).optional().default('manual'),
  triggerConfig: z.record(z.unknown()).optional().default({}),
  mcpCalls: z.array(mcpCallSchema).min(1),
  responseFormat: z.enum(['text', 'json', 'markdown']).optional().default('text'),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** Built-in starter templates shipped with every new workspace. */
export const STARTER_TEMPLATES: Omit<WorkflowTemplate, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>[] = [
  {
    templateName: 'Daily Sales Summary',
    description: 'Pull top deals, recent contacts, and pipeline metrics every morning.',
    triggerType: 'calendar',
    triggerConfig: { cron: '0 9 * * 1-5' },
    mcpCalls: [
      { tool: 'query-context', params: { query: 'active deals in pipeline', entityTypes: ['deal'], topK: 10 } },
      { tool: 'get-metric', params: { name: 'MRR' } },
    ],
    responseFormat: 'markdown',
    isActive: true,
  },
  {
    templateName: 'Weekly Finance Review',
    description: 'Summarize invoices, expenses, and revenue metrics for the week.',
    triggerType: 'calendar',
    triggerConfig: { cron: '0 8 * * 1' },
    mcpCalls: [
      { tool: 'query-context', params: { query: 'invoices and financial transactions', entityTypes: ['invoice', 'transaction'], topK: 20 } },
      { tool: 'get-metric', params: { name: 'ARR' } },
    ],
    responseFormat: 'text',
    isActive: true,
  },
  {
    templateName: 'Customer Health Check',
    description: 'Review at-risk customers based on usage and activity signals.',
    triggerType: 'manual',
    triggerConfig: {},
    mcpCalls: [
      { tool: 'query-context', params: { query: 'customers with low engagement or support tickets', entityTypes: ['contact', 'company'], topK: 15 } },
    ],
    responseFormat: 'json',
    isActive: true,
  },
];

type DbRow = {
  id: string;
  workspace_id: string;
  template_name: string;
  description: string;
  trigger_type: TriggerType;
  trigger_config: TriggerConfig;
  mcp_calls: McpCall[];
  response_format: ResponseFormat;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

function toTemplate(row: DbRow): WorkflowTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateName: row.template_name,
    description: row.description,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config,
    mcpCalls: row.mcp_calls,
    responseFormat: row.response_format,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * CRUD service for agent workflow templates.
 */
export class WorkflowTemplateService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Create a new workflow template for a workspace.
   *
   * @param workspaceId - Workspace identifier
   * @param input - Template definition (validated by createTemplateSchema)
   */
  async createTemplate(
    workspaceId: string,
    input: CreateTemplateInput,
  ): Promise<Result<WorkflowTemplate, Error>> {
    try {
      const validated = createTemplateSchema.parse(input);
      const [row] = await this.sql<DbRow[]>`
        INSERT INTO workflow_templates
          (workspace_id, template_name, description, trigger_type, trigger_config, mcp_calls, response_format)
        VALUES (
          ${workspaceId},
          ${validated.templateName},
          ${validated.description},
          ${validated.triggerType},
          ${JSON.stringify(validated.triggerConfig)},
          ${JSON.stringify(validated.mcpCalls)},
          ${validated.responseFormat}
        )
        RETURNING *
      `;
      if (!row) return err(new Error('No row returned'));
      log.info('Workflow template created', { workspaceId, templateName: validated.templateName });
      return ok(toTemplate(row));
    } catch (e) {
      log.error('Failed to create workflow template', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all workflow templates for a workspace.
   *
   * @param workspaceId - Workspace identifier
   * @param activeOnly - If true, return only active templates. Default: false
   */
  async listTemplates(
    workspaceId: string,
    activeOnly = false,
  ): Promise<Result<WorkflowTemplate[], Error>> {
    try {
      const rows = await this.sql<DbRow[]>`
        SELECT * FROM workflow_templates
        WHERE workspace_id = ${workspaceId}
          ${activeOnly ? this.sql`AND is_active = true` : this.sql``}
        ORDER BY created_at DESC
      `;
      return ok(rows.map(toTemplate));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get a single workflow template by ID.
   *
   * @param workspaceId - Workspace identifier
   * @param id - Template ID
   */
  async getTemplate(
    workspaceId: string,
    id: string,
  ): Promise<Result<WorkflowTemplate | null, Error>> {
    try {
      const [row] = await this.sql<DbRow[]>`
        SELECT * FROM workflow_templates
        WHERE workspace_id = ${workspaceId} AND id = ${id}
      `;
      return ok(row ? toTemplate(row) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Update a workflow template.
   *
   * @param workspaceId - Workspace identifier
   * @param id - Template ID
   * @param input - Fields to update
   */
  async updateTemplate(
    workspaceId: string,
    id: string,
    input: Partial<CreateTemplateInput> & { isActive?: boolean },
  ): Promise<Result<WorkflowTemplate | null, Error>> {
    try {
      const [row] = await this.sql<DbRow[]>`
        UPDATE workflow_templates
        SET
          template_name  = COALESCE(${input.templateName ?? null}, template_name),
          description    = COALESCE(${input.description ?? null}, description),
          trigger_type   = COALESCE(${input.triggerType ?? null}, trigger_type),
          trigger_config = COALESCE(${input.triggerConfig ? JSON.stringify(input.triggerConfig) : null}::jsonb, trigger_config),
          mcp_calls      = COALESCE(${input.mcpCalls ? JSON.stringify(input.mcpCalls) : null}::jsonb, mcp_calls),
          response_format = COALESCE(${input.responseFormat ?? null}, response_format),
          is_active      = COALESCE(${input.isActive ?? null}, is_active),
          updated_at     = NOW()
        WHERE workspace_id = ${workspaceId} AND id = ${id}
        RETURNING *
      `;
      return ok(row ? toTemplate(row) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a workflow template.
   *
   * @param workspaceId - Workspace identifier
   * @param id - Template ID
   */
  async deleteTemplate(
    workspaceId: string,
    id: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const result = await this.sql`
        DELETE FROM workflow_templates
        WHERE workspace_id = ${workspaceId} AND id = ${id}
      `;
      return ok(result.count > 0);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
