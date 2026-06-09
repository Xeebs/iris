import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type postgres from 'postgres';

import { WorkflowService } from '@iris/semantic-core/workflow-service';

type SqlClient = ReturnType<typeof postgres>;

const executeSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  parameters: z.record(z.unknown()).optional().default({}),
  contextBudget: z.number().int().min(100).optional().default(2000),
});

/**
 * REST routes for curated workflow templates and execution sessions.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createWorkflowRoutes(sql: SqlClient) {
  const app = new Hono();
  const getService = () => new WorkflowService(sql);

  /** GET /workflows — list all curated templates */
  app.get('/', (c) => {
    const templates = getService().listCuratedTemplates();
    const category = c.req.query('category');
    const filtered = category
      ? templates.filter((t) => t.category === category)
      : templates;
    return c.json({ data: filtered });
  });

  /** GET /workflows/sessions/:userId — session history for a user */
  app.get('/sessions/:userId', async (c) => {
    const userId = c.req.param('userId');
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const limitRaw = parseInt(c.req.query('limit') ?? '10', 10);
    const limit = Math.min(isNaN(limitRaw) ? 10 : limitRaw, 50);

    try {
      const rows = await sql<{
        session_id: string;
        template_id: string;
        template_name: string;
        status: string;
        result_summary: string | null;
        token_usage: number | null;
        execution_ms: number | null;
        started_at: Date;
        completed_at: Date | null;
      }[]>`
        SELECT session_id, template_id, template_name, status,
               result_summary, token_usage, execution_ms, started_at, completed_at
        FROM workflow_sessions
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
      return c.json({ data: rows });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'DB error' } }, 500);
    }
  });

  /** GET /workflows/sessions/:sessionId/result — fetch execution result */
  app.get('/sessions/:sessionId/result', async (c) => {
    const sessionId = c.req.param('sessionId');

    try {
      const [session] = await sql<{
        session_id: string;
        template_id: string;
        template_name: string;
        status: string;
        parameters: Record<string, unknown>;
        result_summary: string | null;
        token_usage: number | null;
        execution_ms: number | null;
        started_at: Date;
        completed_at: Date | null;
      }[]>`
        SELECT * FROM workflow_sessions WHERE session_id = ${sessionId}
      `;
      if (!session) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }

      const logs = await sql<{
        log_id: string;
        step_index: number;
        tool_name: string;
        tool_params: Record<string, unknown>;
        tool_response: string | null;
        token_count: number | null;
        latency_ms: number | null;
        status: string;
        error_message: string | null;
        executed_at: Date;
      }[]>`
        SELECT * FROM workflow_execution_logs
        WHERE session_id = ${sessionId}
        ORDER BY step_index
      `;
      return c.json({ data: { session, logs } });
    } catch (e) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'DB error' } }, 500);
    }
  });

  /** GET /workflows/:id — get curated template by ID with context preview */
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const templates = getService().listCuratedTemplates();
    const template = templates.find((t) => t.id === id);
    if (!template) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Workflow "${id}" not found` } }, 404);
    }

    const workspaceId = c.req.query('workspaceId');
    let contextPreview = null;
    if (workspaceId) {
      const svc = getService();
      const instantiateResult = await svc.instantiateTemplate(workspaceId, id);
      if (instantiateResult.isOk()) {
        const optimizeResult = await svc.optimizeContextForWorkflow(workspaceId, instantiateResult.value.id);
        if (optimizeResult.isOk()) contextPreview = optimizeResult.value;
      }
    }

    return c.json({ data: { ...template, contextPreview } });
  });

  /** POST /workflows/:id/execute — create a new workflow session */
  app.post(
    '/:id/execute',
    zValidator('json', executeSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: result.error.message } }, 400);
      }
    }),
    async (c) => {
      const templateId = c.req.param('id');
      const body = c.req.valid('json');

      const templates = getService().listCuratedTemplates();
      const template = templates.find((t) => t.id === templateId);
      if (!template) {
        return c.json({ error: { code: 'NOT_FOUND', message: `Workflow "${templateId}" not found` } }, 404);
      }

      if (body.contextBudget > 8000) {
        return c.json(
          { error: { code: 'BUDGET_EXCEEDED', message: 'contextBudget must not exceed 8000 tokens' } },
          422,
        );
      }

      try {
        const [session] = await sql<{ session_id: string; status: string; started_at: Date }[]>`
          INSERT INTO workflow_sessions
            (workspace_id, user_id, template_id, template_name, status, parameters)
          VALUES (
            ${body.workspaceId},
            ${body.userId},
            ${templateId},
            ${template.name},
            'pending',
            ${JSON.stringify(body.parameters)}
          )
          RETURNING session_id, status, started_at
        `;
        if (!session) throw new Error('No session row returned');
        return c.json({ data: session }, 201);
      } catch (e) {
        return c.json({ error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'DB error' } }, 500);
      }
    },
  );

  return app;
}
