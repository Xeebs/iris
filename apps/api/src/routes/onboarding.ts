import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'onboarding' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const updateStepSchema = z.object({
  step: z.number().int().min(1).max(7),
  industry: z.string().min(1).optional(),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
  useCase: z.string().min(1).optional(),
  selectedConnectors: z.array(z.string()).min(1).max(5).optional(),
  firstSyncTriggered: z.boolean().optional(),
});

const TOTAL_STEPS = 7;

// ─── Industry glossary templates ──────────────────────────────────────────────

const INDUSTRY_GLOSSARY_TEMPLATES: Record<string, Array<{ term: string; definition: string }>> = {
  finance: [
    { term: 'ARR', definition: 'Annual Recurring Revenue — the value of contracted recurring revenue normalized to one year' },
    { term: 'MRR', definition: 'Monthly Recurring Revenue — predictable recurring revenue in a given month' },
    { term: 'CAC', definition: 'Customer Acquisition Cost — total cost to acquire one new customer' },
    { term: 'LTV', definition: 'Lifetime Value — total revenue expected from a customer over their relationship' },
    { term: 'Churn Rate', definition: 'Percentage of customers who cancel in a given period' },
  ],
  sales: [
    { term: 'Pipeline Stage', definition: 'The phase a deal is in within the sales process (e.g., Prospecting, Qualification, Proposal)' },
    { term: 'Win Rate', definition: 'Percentage of qualified opportunities that result in closed-won deals' },
    { term: 'ACV', definition: 'Annual Contract Value — average annual revenue per customer contract' },
    { term: 'ICP', definition: 'Ideal Customer Profile — description of the highest-value customer type' },
    { term: 'SQL', definition: 'Sales Qualified Lead — a lead that has been vetted and is ready for direct sales engagement' },
  ],
  operations: [
    { term: 'SLA', definition: 'Service Level Agreement — commitment to deliver service at a defined level (e.g., 99.9% uptime)' },
    { term: 'OKR', definition: 'Objectives and Key Results — goal-setting framework tracking measurable outcomes' },
    { term: 'MTTR', definition: 'Mean Time To Recovery — average time to restore service after an incident' },
    { term: 'Throughput', definition: 'Amount of work completed in a given time period' },
  ],
  hr: [
    { term: 'Headcount', definition: 'Total number of employees in the organization or department' },
    { term: 'Attrition Rate', definition: 'Percentage of employees who leave the organization in a given period' },
    { term: 'Time to Hire', definition: 'Number of days from job opening to accepted offer' },
    { term: 'eNPS', definition: 'Employee Net Promoter Score — measure of employee satisfaction and loyalty' },
  ],
};

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /onboarding
 */
export function createOnboardingRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /onboarding/status — get current onboarding state */
  app.get('/status', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    try {
      const rows = await sql`
        SELECT id, workspace_id, status, current_step, completed_steps,
               industry, company_size, use_case, selected_connectors,
               first_sync_triggered, completed_at, created_at, updated_at
        FROM workspace_onboarding
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return c.json({
          data: {
            started: false,
            status: null,
            currentStep: null,
            completedSteps: [],
            totalSteps: TOTAL_STEPS,
          },
        });
      }

      return c.json({ data: mapOnboardingRow(rows[0]) });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to get onboarding status', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get onboarding status' } }, 500);
    }
  });

  /** POST /onboarding/start — initialize onboarding for workspace */
  app.post('/start', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    try {
      const rows = await sql`
        INSERT INTO workspace_onboarding (workspace_id, status, current_step)
        VALUES (${workspaceId}, 'in_progress', 1)
        ON CONFLICT (workspace_id) DO UPDATE
          SET status = CASE WHEN workspace_onboarding.status = 'completed' THEN 'completed'
                            ELSE 'in_progress' END,
              updated_at = now()
        RETURNING id, workspace_id, status, current_step, completed_steps,
                  industry, company_size, use_case, selected_connectors,
                  first_sync_triggered, completed_at, created_at, updated_at
      `;

      return c.json({ data: mapOnboardingRow(rows[0]) }, 201);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to start onboarding', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to start onboarding' } }, 500);
    }
  });

  /** PUT /onboarding/step — update onboarding step progress */
  app.put('/step', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => null);

    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = updateStepSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { step } = parsed.data;
    const isLastStep = step === TOTAL_STEPS;

    try {
      const rows = await sql`
        UPDATE workspace_onboarding
        SET current_step = ${step},
            completed_steps = array_append(
              array_remove(completed_steps, ${step - 1}::int),
              ${step - 1}::int
            ),
            industry = COALESCE(${parsed.data.industry ?? null}, industry),
            company_size = COALESCE(${parsed.data.companySize ?? null}, company_size),
            use_case = COALESCE(${parsed.data.useCase ?? null}, use_case),
            selected_connectors = COALESCE(${parsed.data.selectedConnectors ? sql.array(parsed.data.selectedConnectors) : null}, selected_connectors),
            first_sync_triggered = COALESCE(${parsed.data.firstSyncTriggered ?? null}, first_sync_triggered),
            status = ${isLastStep ? 'completed' : 'in_progress'},
            completed_at = ${isLastStep ? new Date().toISOString() : null},
            updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND status = 'in_progress'
        RETURNING id, workspace_id, status, current_step, completed_steps,
                  industry, company_size, use_case, selected_connectors,
                  first_sync_triggered, completed_at, created_at, updated_at
      `;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'No active onboarding session found' } }, 404);
      }

      log.info('Onboarding step updated', { workspaceId, step, isLastStep });
      return c.json({ data: mapOnboardingRow(rows[0]) });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to update onboarding step', { workspaceId, step, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update step' } }, 500);
    }
  });

  /** POST /onboarding/skip — skip onboarding entirely */
  app.post('/skip', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    try {
      await sql`
        INSERT INTO workspace_onboarding (workspace_id, status, current_step)
        VALUES (${workspaceId}, 'skipped', 1)
        ON CONFLICT (workspace_id) DO UPDATE
          SET status = 'skipped', updated_at = now()
      `;

      log.info('Onboarding skipped', { workspaceId });
      return c.json({ data: { status: 'skipped' } });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to skip onboarding', { workspaceId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to skip onboarding' } }, 500);
    }
  });

  /** GET /onboarding/glossary-templates — return industry glossary templates */
  app.get('/glossary-templates', async (c) => {
    const industry = c.req.query('industry');

    if (industry) {
      const terms = INDUSTRY_GLOSSARY_TEMPLATES[industry.toLowerCase()] ?? [];
      return c.json({ data: { industry, terms } });
    }

    return c.json({
      data: {
        industries: Object.keys(INDUSTRY_GLOSSARY_TEMPLATES),
        templates: INDUSTRY_GLOSSARY_TEMPLATES,
      },
    });
  });

  return app;
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

interface OnboardingRow {
  id: string;
  workspace_id: string;
  status: string;
  current_step: number;
  completed_steps: number[];
  industry: string | null;
  company_size: string | null;
  use_case: string | null;
  selected_connectors: string[];
  first_sync_triggered: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapOnboardingRow(r: unknown) {
  const row = r as OnboardingRow;
  return {
    started: true,
    status: row.status,
    currentStep: row.current_step,
    completedSteps: row.completed_steps ?? [],
    totalSteps: TOTAL_STEPS,
    industry: row.industry,
    companySize: row.company_size,
    useCase: row.use_case,
    selectedConnectors: row.selected_connectors ?? [],
    firstSyncTriggered: row.first_sync_triggered,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
