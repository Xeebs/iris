import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'agent-feedback-engine' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type FeedbackSource = 'explicit' | 'implicit' | 'inferred';

export type AgentContextUsage = {
  usageId: string;
  agentId: string;
  workspaceId: string;
  queryHash: string;
  contextIds: string[];
  contextBudgetUsed: number;
  servedAt: Date;
};

export type AgentFeedback = {
  feedbackId: string;
  usageId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  correctedContextJson: Record<string, unknown> | null;
  createdAt: Date;
  feedbackSource: FeedbackSource;
};

export type RelevanceAdjustment = {
  entityType: string;
  workspaceId: string;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  weightAdjustment: number;
  lastUpdatedAt: Date;
};

export type ContextExpansionSuggestion = {
  agentId: string;
  workspaceId: string;
  suggestedEntityTypes: string[];
  reasoning: string;
  confidenceScore: number;
};

export type AgentInsights = {
  agentId: string;
  workspaceId: string;
  totalUsages: number;
  avgRating: number;
  mostUsefulEntityTypes: string[];
  leastUsefulEntityTypes: string[];
  feedbackCount: number;
};

export type ImplicitFeedbackSignal = {
  usageId: string;
  signal: 'positive' | 'negative';
  reason: string;
  impliedRating: 1 | 2 | 4 | 5;
};

/**
 * Detect implicit feedback signals from agent behavior patterns.
 * @param previousQueryHash - Hash of the last query by this agent
 * @param currentQueryHash - Hash of the current query (re-query = negative signal)
 * @param agentResponse - Text of the agent's response (quoting context = positive signal)
 * @param contextServedIds - IDs of entities that were served in the previous context
 */
export function inferFeedback(
  previousQueryHash: string,
  currentQueryHash: string,
  agentResponse: string,
  contextServedIds: string[],
): ImplicitFeedbackSignal | null {
  // Positive: agent quotes entity IDs from served context in response
  const quotedIds = contextServedIds.filter(id => agentResponse.includes(id));
  if (quotedIds.length > 0) {
    return {
      usageId: '',
      signal: 'positive',
      reason: `Agent referenced ${quotedIds.length} served entities in response`,
      impliedRating: quotedIds.length >= 3 ? 5 : 4,
    };
  }

  // Negative: same query re-issued (previous context insufficient)
  if (previousQueryHash === currentQueryHash) {
    return {
      usageId: '',
      signal: 'negative',
      reason: 'Agent re-issued identical query — previous context likely insufficient',
      impliedRating: 2,
    };
  }

  return null;
}

/**
 * Compute a weight adjustment delta from feedback counts.
 * @param positiveCount - Number of positive feedback instances
 * @param negativeCount - Number of negative feedback instances
 */
export function computeWeightAdjustment(positiveCount: number, negativeCount: number): number {
  const total = positiveCount + negativeCount;
  if (total === 0) return 0;
  // Score: normalized ratio, clamped to [-0.5, +0.5]
  const ratio = (positiveCount - negativeCount) / total;
  return Math.max(-0.5, Math.min(0.5, ratio * 0.5));
}

/**
 * Record an agent's context usage to the DB.
 * @param sql - SQL function
 * @param usage - Usage record to insert
 */
export async function recordAgentUsage(
  sql: SqlFn,
  usage: AgentContextUsage,
): Promise<Result<void, Error>> {
  try {
    await sql`
      INSERT INTO agent_context_usage (
        usage_id, agent_id, workspace_id, query_hash, context_ids,
        context_budget_used, served_at
      ) VALUES (
        ${usage.usageId}, ${usage.agentId}, ${usage.workspaceId},
        ${usage.queryHash}, ${usage.contextIds}, ${usage.contextBudgetUsed}, ${usage.servedAt}
      )
      ON CONFLICT (usage_id) DO NOTHING
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Record explicit user feedback on a context usage.
 * @param sql - SQL function
 * @param feedback - Feedback to record
 */
export async function recordUserFeedback(
  sql: SqlFn,
  feedback: Omit<AgentFeedback, 'feedbackId' | 'createdAt'>,
): Promise<Result<string, Error>> {
  try {
    const feedbackId = crypto.randomUUID();
    await sql`
      INSERT INTO agent_feedback (
        feedback_id, usage_id, rating, comment, corrected_context_json,
        created_at, feedback_source
      ) VALUES (
        ${feedbackId}, ${feedback.usageId}, ${feedback.rating},
        ${feedback.comment}, ${feedback.correctedContextJson ? JSON.stringify(feedback.correctedContextJson) : null},
        NOW(), ${feedback.feedbackSource}
      )
    `;
    log.info('User feedback recorded', { feedbackId, usageId: feedback.usageId, rating: feedback.rating });
    return ok(feedbackId);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Update relevance weights for entity types based on aggregated feedback.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param entityType - Entity type to update weights for
 * @param rating - New feedback rating (1-5)
 */
export async function updateRelevanceWeights(
  sql: SqlFn,
  workspaceId: string,
  entityType: string,
  rating: number,
): Promise<Result<void, Error>> {
  try {
    const isPositive = rating >= 4;
    const positiveInc = isPositive ? 1 : 0;
    const negativeInc = !isPositive ? 1 : 0;

    const rows = await sql`
      INSERT INTO relevance_adjustments (
        entity_type, workspace_id, positive_feedback_count,
        negative_feedback_count, weight_adjustment, last_updated_at
      ) VALUES (
        ${entityType}, ${workspaceId}, ${positiveInc}, ${negativeInc}, 0, NOW()
      )
      ON CONFLICT (entity_type, workspace_id) DO UPDATE SET
        positive_feedback_count = relevance_adjustments.positive_feedback_count + ${positiveInc},
        negative_feedback_count = relevance_adjustments.negative_feedback_count + ${negativeInc},
        last_updated_at = NOW()
      RETURNING positive_feedback_count, negative_feedback_count
    ` as unknown as Array<{ positive_feedback_count: number; negative_feedback_count: number }>;

    if (rows.length > 0) {
      const { positive_feedback_count, negative_feedback_count } = rows[0]!;
      const newWeight = computeWeightAdjustment(positive_feedback_count, negative_feedback_count);
      await sql`
        UPDATE relevance_adjustments
        SET weight_adjustment = ${newWeight}
        WHERE entity_type = ${entityType} AND workspace_id = ${workspaceId}
      `;
    }

    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Suggest context expansion based on patterns in agent feedback.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param agentId - Agent to analyze patterns for
 */
export async function suggestContextExpansion(
  sql: SqlFn,
  workspaceId: string,
  agentId: string,
): Promise<Result<ContextExpansionSuggestion, Error>> {
  try {
    // Find entity types with positive feedback from this agent
    const positiveRows = await sql`
      SELECT DISTINCT unnest(acu.context_ids) AS entity_id
      FROM agent_context_usage acu
      JOIN agent_feedback af ON af.usage_id = acu.usage_id
      WHERE acu.workspace_id = ${workspaceId}
        AND acu.agent_id = ${agentId}
        AND af.rating >= 4
      LIMIT 100
    ` as unknown as Array<{ entity_id: string }>;

    // Extract entity types from IDs (format: connector:type:id)
    const typeCount = new Map<string, number>();
    for (const r of positiveRows) {
      const parts = r.entity_id.split(':');
      if (parts.length >= 2) {
        const t = parts[1]!;
        typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
      }
    }

    // Find low-feedback entity types to suggest expanding
    const negativeRows = await sql`
      SELECT DISTINCT unnest(acu.context_ids) AS entity_id
      FROM agent_context_usage acu
      JOIN agent_feedback af ON af.usage_id = acu.usage_id
      WHERE acu.workspace_id = ${workspaceId}
        AND acu.agent_id = ${agentId}
        AND af.rating <= 2
      LIMIT 100
    ` as unknown as Array<{ entity_id: string }>;

    const negativeTypes = new Set<string>();
    for (const r of negativeRows) {
      const parts = r.entity_id.split(':');
      if (parts.length >= 2) negativeTypes.add(parts[1]!);
    }

    // Suggest types that are highly rated but not in the negative set
    const suggestedEntityTypes = [...typeCount.entries()]
      .filter(([t]) => !negativeTypes.has(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    const confidenceScore = suggestedEntityTypes.length > 0
      ? Math.min(1, positiveRows.length / 10)
      : 0;

    return ok({
      agentId,
      workspaceId,
      suggestedEntityTypes,
      reasoning: `Based on ${positiveRows.length} positive feedback signals`,
      confidenceScore,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get aggregated feedback insights for an agent.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param agentId - Agent ID
 */
export async function getAgentInsights(
  sql: SqlFn,
  workspaceId: string,
  agentId: string,
): Promise<Result<AgentInsights, Error>> {
  try {
    const statsRows = await sql`
      SELECT
        COUNT(DISTINCT acu.usage_id) AS total_usages,
        AVG(af.rating) AS avg_rating,
        COUNT(DISTINCT af.feedback_id) AS feedback_count
      FROM agent_context_usage acu
      LEFT JOIN agent_feedback af ON af.usage_id = acu.usage_id
      WHERE acu.workspace_id = ${workspaceId} AND acu.agent_id = ${agentId}
    ` as unknown as Array<{ total_usages: string; avg_rating: string; feedback_count: string }>;

    const usefulRows = await sql`
      SELECT ra.entity_type, ra.weight_adjustment
      FROM relevance_adjustments ra
      WHERE ra.workspace_id = ${workspaceId}
      ORDER BY ra.weight_adjustment DESC
      LIMIT 10
    ` as unknown as Array<{ entity_type: string; weight_adjustment: string }>;

    const stats = statsRows[0] ?? { total_usages: '0', avg_rating: '0', feedback_count: '0' };
    const ranked = usefulRows.map(r => ({ type: r.entity_type, weight: parseFloat(r.weight_adjustment) }));

    return ok({
      agentId,
      workspaceId,
      totalUsages: parseInt(stats.total_usages, 10) || 0,
      avgRating: parseFloat(stats.avg_rating) || 0,
      mostUsefulEntityTypes: ranked.filter(r => r.weight > 0).map(r => r.type),
      leastUsefulEntityTypes: ranked.filter(r => r.weight < 0).map(r => r.type),
      feedbackCount: parseInt(stats.feedback_count, 10) || 0,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get relevance weight adjustments for all entity types in a workspace.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 */
export async function getRelevanceAdjustments(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<RelevanceAdjustment[], Error>> {
  try {
    const rows = await sql`
      SELECT entity_type, workspace_id, positive_feedback_count,
             negative_feedback_count, weight_adjustment, last_updated_at
      FROM relevance_adjustments
      WHERE workspace_id = ${workspaceId}
      ORDER BY ABS(weight_adjustment) DESC
    ` as unknown as Array<{
      entity_type: string;
      workspace_id: string;
      positive_feedback_count: number;
      negative_feedback_count: number;
      weight_adjustment: string;
      last_updated_at: string;
    }>;

    return ok(rows.map(r => ({
      entityType: r.entity_type,
      workspaceId: r.workspace_id,
      positiveFeedbackCount: r.positive_feedback_count,
      negativeFeedbackCount: r.negative_feedback_count,
      weightAdjustment: parseFloat(r.weight_adjustment),
      lastUpdatedAt: new Date(r.last_updated_at),
    })));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
