import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'onboarding-manager' });

type SqlClient = ReturnType<typeof postgres>;

export type OnboardingStage =
  | 'workspace_setup'
  | 'connector_selection'
  | 'oauth_connect'
  | 'schema_review'
  | 'glossary'
  | 'first_sync'
  | 'complete';

export interface ConnectorRecommendation {
  connectorId: string;
  name: string;
  reason: string;
  priority: number;
}

export interface CompletionMetrics {
  connectorsAdded: number;
  entitiesIndexed: number;
  timeToFirstSyncMs: number;
}

export interface OnboardingStatus {
  workspaceId: string;
  stage: OnboardingStage;
  currentStep: number;
  completedSteps: number[];
  industry: string | null;
  companySize: string | null;
  completedAt: Date | null;
  metricsJson: CompletionMetrics | null;
}

const CONNECTOR_RECOMMENDATIONS: Record<
  string,
  Array<{ connectorId: string; name: string; reason: string; priority: number }>
> = {
  sales: [
    { connectorId: 'hubspot', name: 'HubSpot', reason: 'CRM for contacts, deals, and pipeline management', priority: 1 },
    { connectorId: 'salesforce', name: 'Salesforce', reason: 'Enterprise CRM with deep account and opportunity data', priority: 2 },
    { connectorId: 'slack', name: 'Slack', reason: 'Sales communication and deal discussion context', priority: 3 },
    { connectorId: 'google-drive', name: 'Google Drive', reason: 'Proposals, contracts, and sales collateral', priority: 4 },
    { connectorId: 'notion', name: 'Notion', reason: 'Sales playbooks and account research notes', priority: 5 },
  ],
  finance: [
    { connectorId: 'quickbooks', name: 'QuickBooks', reason: 'Financial transactions, invoices, and expense data', priority: 1 },
    { connectorId: 'netsuite', name: 'NetSuite', reason: 'ERP financials for enterprise finance teams', priority: 2 },
    { connectorId: 'google-drive', name: 'Google Drive', reason: 'Financial models and reports', priority: 3 },
    { connectorId: 'notion', name: 'Notion', reason: 'Finance processes and documentation', priority: 4 },
    { connectorId: 'slack', name: 'Slack', reason: 'Finance team communication and alerts', priority: 5 },
  ],
  engineering: [
    { connectorId: 'linear', name: 'Linear', reason: 'Issue tracking and sprint management', priority: 1 },
    { connectorId: 'jira', name: 'Jira', reason: 'Project and issue tracking at scale', priority: 2 },
    { connectorId: 'notion', name: 'Notion', reason: 'Engineering documentation and RFCs', priority: 3 },
    { connectorId: 'confluence', name: 'Confluence', reason: 'Technical documentation and runbooks', priority: 4 },
    { connectorId: 'slack', name: 'Slack', reason: 'Engineering discussion and incident context', priority: 5 },
  ],
  operations: [
    { connectorId: 'notion', name: 'Notion', reason: 'SOPs and process documentation', priority: 1 },
    { connectorId: 'airtable', name: 'Airtable', reason: 'Operational data and tracking databases', priority: 2 },
    { connectorId: 'slack', name: 'Slack', reason: 'Cross-team communication and escalations', priority: 3 },
    { connectorId: 'jira', name: 'Jira', reason: 'Project and workflow tracking', priority: 4 },
    { connectorId: 'google-drive', name: 'Google Drive', reason: 'Operations reports and templates', priority: 5 },
  ],
  hr: [
    { connectorId: 'notion', name: 'Notion', reason: 'HR policies and onboarding documentation', priority: 1 },
    { connectorId: 'slack', name: 'Slack', reason: 'Team communication and announcements', priority: 2 },
    { connectorId: 'airtable', name: 'Airtable', reason: 'Employee data and org charts', priority: 3 },
    { connectorId: 'google-drive', name: 'Google Drive', reason: 'Job descriptions, offer letters, and reviews', priority: 4 },
    { connectorId: 'confluence', name: 'Confluence', reason: 'Company wiki and HR knowledge base', priority: 5 },
  ],
};

const DEFAULT_RECOMMENDATIONS: Array<{
  connectorId: string;
  name: string;
  reason: string;
  priority: number;
}> = [
  { connectorId: 'notion', name: 'Notion', reason: 'General-purpose knowledge base and documentation', priority: 1 },
  { connectorId: 'slack', name: 'Slack', reason: 'Team communication context', priority: 2 },
  { connectorId: 'google-drive', name: 'Google Drive', reason: 'Documents and files', priority: 3 },
  { connectorId: 'hubspot', name: 'HubSpot', reason: 'CRM data and customer context', priority: 4 },
  { connectorId: 'linear', name: 'Linear', reason: 'Project and issue tracking', priority: 5 },
];

const STEP_TO_STAGE: Record<number, OnboardingStage> = {
  1: 'workspace_setup',
  2: 'connector_selection',
  3: 'oauth_connect',
  4: 'schema_review',
  5: 'glossary',
  6: 'first_sync',
  7: 'complete',
};

/**
 * Manages onboarding progression and provides connector recommendations.
 */
export class OnboardingManager {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Records that a workspace reached a given onboarding stage.
   * @param workspaceId - Workspace identifier
   * @param stage - Stage to record
   * @returns Updated onboarding status
   */
  async trackOnboardingStage(
    workspaceId: string,
    stage: OnboardingStage,
  ): Promise<Result<OnboardingStatus, Error>> {
    const stepNumber = Object.entries(STEP_TO_STAGE).find(([, s]) => s === stage)?.[0];
    const step = stepNumber ? parseInt(stepNumber, 10) : 1;
    const isComplete = stage === 'complete';

    try {
      const newStatus = isComplete ? 'completed' : 'in_progress';
      const rows = await this.sql`
        INSERT INTO workspace_onboarding (workspace_id, status, current_step)
        VALUES (${workspaceId}, ${newStatus}, ${step})
        ON CONFLICT (workspace_id) DO UPDATE
          SET current_step = ${step},
              completed_steps = array_append(
                array_remove(workspace_onboarding.completed_steps, ${step - 1}::int),
                ${step - 1}::int
              ),
              status = ${newStatus},
              completed_at = ${isComplete ? new Date().toISOString() : null},
              updated_at = now()
        RETURNING workspace_id, status, current_step, completed_steps,
                  industry, company_size, completed_at
      `;

      if (rows.length === 0) {
        return err(new Error('Failed to track onboarding stage'));
      }

      log.info('Onboarding stage tracked', { workspaceId, stage, step });
      return ok(mapToStatus(rows[0], null));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to track onboarding stage', { workspaceId, stage, error: error.message });
      return err(error);
    }
  }

  /**
   * Returns recommended connectors ranked by relevance to company profile.
   * @param companySize - Company headcount range
   * @param industry - Company industry vertical
   * @returns Ordered list of connector recommendations (top 5)
   */
  getRecommendedConnectors(
    companySize: string | null,
    industry: string | null,
  ): ConnectorRecommendation[] {
    const baseRecs =
      (industry && CONNECTOR_RECOMMENDATIONS[industry.toLowerCase()]) ??
      DEFAULT_RECOMMENDATIONS;

    const recs = [...baseRecs];

    if (companySize === '1-10' || companySize === '11-50') {
      const notionIdx = recs.findIndex((r) => r.connectorId === 'notion');
      if (notionIdx > 0) {
        const [notion] = recs.splice(notionIdx, 1);
        recs.unshift({ ...notion, priority: 1 });
        recs.forEach((r, i) => { r.priority = i + 1; });
      }
    }

    return recs.slice(0, 5).map((r) => ({
      connectorId: r.connectorId,
      name: r.name,
      reason: r.reason,
      priority: r.priority,
    }));
  }

  /**
   * Records completion metrics when a workspace finishes onboarding.
   * @param workspaceId - Workspace identifier
   * @param connectorsAdded - Number of connectors configured
   * @param entitiesIndexed - Total entities indexed in first sync
   * @param timeToFirstSyncMs - Milliseconds from start to first sync completion
   */
  async recordCompletionMetrics(
    workspaceId: string,
    connectorsAdded: number,
    entitiesIndexed: number,
    timeToFirstSyncMs: number,
  ): Promise<Result<void, Error>> {
    const metrics: CompletionMetrics = {
      connectorsAdded,
      entitiesIndexed,
      timeToFirstSyncMs,
    };

    try {
      await this.sql`
        UPDATE workspace_onboarding
        SET status = 'completed',
            first_sync_triggered = ${entitiesIndexed > 0},
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE workspace_id = ${workspaceId}
      `;

      log.info('Onboarding completion metrics recorded', {
        workspaceId,
        connectorsAdded,
        entitiesIndexed,
        timeToFirstSyncMs,
        metrics,
      });

      return ok(undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to record completion metrics', { workspaceId, error: error.message });
      return err(error);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface OnboardingRow {
  workspace_id: string;
  status: string;
  current_step: number;
  completed_steps: number[];
  industry: string | null;
  company_size: string | null;
  completed_at: Date | null;
}

function mapToStatus(row: unknown, metricsJson: CompletionMetrics | null): OnboardingStatus {
  const r = row as OnboardingRow;
  const step = r.current_step ?? 1;
  return {
    workspaceId: r.workspace_id,
    stage: STEP_TO_STAGE[step] ?? 'workspace_setup',
    currentStep: step,
    completedSteps: r.completed_steps ?? [],
    industry: r.industry,
    companySize: r.company_size,
    completedAt: r.completed_at,
    metricsJson,
  };
}
