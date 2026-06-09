import { randomBytes } from 'crypto';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

export type QueryIntentType =
  | 'metric-lookup'
  | 'entity-search'
  | 'trend-analysis'
  | 'comparison'
  | 'aggregation';

export type QueryIntent = {
  type: QueryIntentType;
  confidence: number;
  keywords: string[];
  entityTypes: string[];
};

export type ContextQueryPlan = {
  intentType: QueryIntentType;
  entityTypes: string[];
  filters: Record<string, unknown>;
  aggregations: string[];
  limit: number;
  explanation: string;
};

export type NlQuerySession = {
  sessionId: string;
  workspaceId: string;
  question: string;
  intent: QueryIntent;
  queryPlan: ContextQueryPlan;
  followUpQuestions: string[];
  createdAt: Date;
};

export type NlQueryFeedback = {
  sessionId: string;
  helpful: boolean;
  notes: string | null;
  createdAt: Date;
};

type SessionRow = {
  session_id: string;
  workspace_id: string;
  question: string;
  intent: QueryIntent;
  query_plan: ContextQueryPlan;
  follow_up_questions: string[];
  created_at: Date;
};

// Intent classification rules — pattern → intent type
const INTENT_RULES: Array<{ patterns: string[]; type: QueryIntentType; confidence: number }> = [
  { patterns: ['total', 'count', 'how many', 'sum', 'average', 'avg', 'percent', '%'], type: 'aggregation', confidence: 0.85 },
  { patterns: ['trend', 'over time', 'growth', 'decline', 'compare month', 'compare quarter'], type: 'trend-analysis', confidence: 0.82 },
  { patterns: ['compare', 'vs', 'versus', 'difference between', 'which is better'], type: 'comparison', confidence: 0.80 },
  { patterns: ['revenue', 'arr', 'mrr', 'churn', 'pipeline value', 'win rate', 'conversion'], type: 'metric-lookup', confidence: 0.88 },
  { patterns: ['find', 'show', 'list', 'get', 'search', 'who is', 'which', 'all contacts', 'all companies'], type: 'entity-search', confidence: 0.75 },
];

const ENTITY_TYPE_KEYWORDS: Record<string, string[]> = {
  contact: ['contact', 'person', 'lead', 'prospect', 'customer', 'user', 'rep', 'owner'],
  company: ['company', 'companies', 'account', 'organization', 'business', 'firm', 'client'],
  deal: ['deal', 'opportunity', 'opp', 'pipeline', 'sale'],
  ticket: ['ticket', 'issue', 'support', 'case', 'request'],
  product: ['product', 'item', 'sku', 'service', 'plan'],
  campaign: ['campaign', 'marketing', 'email blast', 'promotion'],
};

const FOLLOW_UP_TEMPLATES: Record<QueryIntentType, string[]> = {
  'entity-search': [
    'Filter by a specific attribute?',
    'Sort results by a field?',
    'Show relationships between these entities?',
  ],
  'metric-lookup': [
    'Break this metric down by time period?',
    'Compare to a previous period?',
    'Show which entities drive this metric?',
  ],
  'trend-analysis': [
    'What caused this trend?',
    'Forecast this metric forward?',
    'Compare trend across segments?',
  ],
  'comparison': [
    'Drill down into the winning segment?',
    'Show underlying entities for each group?',
    'Export comparison as a report?',
  ],
  'aggregation': [
    'Show top N contributors?',
    'Break down by entity type?',
    'Set an alert threshold on this?',
  ],
};

/**
 * Injectable LLM client interface — allows tests to provide a stub.
 */
export type LlmClient = {
  complete(prompt: string): Promise<string>;
};

export class NlQueryGenerator {
  constructor(
    private readonly sql: Sql,
    private readonly llmClient?: LlmClient
  ) {}

  /**
   * Classifies the intent of a natural language query using rule-based matching
   * and optional LLM enhancement.
   * @param question - User's natural language question
   * @returns Classified intent with confidence score and entity types
   */
  async classifyQueryIntent(question: string): Promise<QueryIntent> {
    const lower = question.toLowerCase();
    const keywords = lower.split(/\s+/).filter((w) => w.length > 2);

    // Rule-based intent classification
    let bestType: QueryIntentType = 'entity-search';
    let bestConfidence = 0.5;

    for (const rule of INTENT_RULES) {
      if (rule.patterns.some((p) => lower.includes(p))) {
        if (rule.confidence > bestConfidence) {
          bestConfidence = rule.confidence;
          bestType = rule.type;
        }
      }
    }

    // Optional LLM enhancement for borderline cases
    if (this.llmClient && bestConfidence < 0.75) {
      try {
        const prompt = `Classify this business query into one of: metric-lookup, entity-search, trend-analysis, comparison, aggregation.\nQuery: "${question}"\nRespond with only the type name.`;
        const response = (await this.llmClient.complete(prompt)).trim().toLowerCase();
        const valid: QueryIntentType[] = ['metric-lookup', 'entity-search', 'trend-analysis', 'comparison', 'aggregation'];
        if (valid.includes(response as QueryIntentType)) {
          bestType = response as QueryIntentType;
          bestConfidence = 0.78;
        }
      } catch (e) {
        logger.warn('LLM intent classification failed, using rule-based result', { error: e });
      }
    }

    const entityTypes = this.mapEntityKeywordsToTypes(lower);

    return {
      type: bestType,
      confidence: bestConfidence,
      keywords,
      entityTypes,
    };
  }

  /**
   * Maps entity-related keywords in a question to canonical entity type names.
   * @param lowerQuestion - Lowercased question string
   * @returns Matched entity types
   */
  mapEntityKeywordsToTypes(lowerQuestion: string): string[] {
    const matched: string[] = [];
    for (const [type, keywords] of Object.entries(ENTITY_TYPE_KEYWORDS)) {
      if (keywords.some((k) => lowerQuestion.includes(k))) {
        matched.push(type);
      }
    }
    return matched.length > 0 ? matched : ['contact', 'company'];
  }

  /**
   * Generates a structured context query plan from a classified intent.
   * @param intent - Classified query intent
   * @param contextBudget - Token budget for the query
   * @returns A concrete context query plan
   */
  generateQueryPlan(intent: QueryIntent, contextBudget = 2000): ContextQueryPlan {
    const limit = Math.min(50, Math.floor(contextBudget / 40));
    const aggregations: string[] = [];
    const filters: Record<string, unknown> = {};

    switch (intent.type) {
      case 'aggregation':
        aggregations.push('count', 'sum');
        break;
      case 'trend-analysis':
        aggregations.push('count_by_day', 'rolling_average');
        filters['timeRange'] = 'last_30_days';
        break;
      case 'comparison':
        aggregations.push('group_by', 'compare');
        break;
      case 'metric-lookup':
        aggregations.push('sum', 'average');
        break;
      default:
        break;
    }

    const explanation = buildPlanExplanation(intent, limit);

    return {
      intentType: intent.type,
      entityTypes: intent.entityTypes,
      filters,
      aggregations,
      limit,
      explanation,
    };
  }

  /**
   * Suggests follow-up questions based on the original question and query plan.
   * @param question - Original user question
   * @param plan - Generated query plan
   * @returns Array of follow-up question suggestions
   */
  suggestFollowUpQueries(question: string, plan: ContextQueryPlan): string[] {
    const templates = FOLLOW_UP_TEMPLATES[plan.intentType] ?? FOLLOW_UP_TEMPLATES['entity-search'];
    const lower = question.toLowerCase();

    const contextual: string[] = [];
    if (lower.includes('contact')) contextual.push('Show email engagement for these contacts?');
    if (lower.includes('deal') || lower.includes('opportunity')) contextual.push('What is the close probability for these deals?');
    if (lower.includes('company')) contextual.push('Show recent activity for these companies?');

    return [...contextual, ...templates].slice(0, 3);
  }

  /**
   * Full pipeline: classify intent, generate plan, suggest follow-ups, persist session.
   * @param question - User's natural language question
   * @param workspaceId - Workspace scope
   * @param contextBudget - Token budget
   * @returns Complete session with plan and suggestions
   */
  async processNaturalLanguageQuery(
    question: string,
    workspaceId: string,
    contextBudget = 2000
  ): Promise<NlQuerySession> {
    const sessionId = randomBytes(16).toString('hex');
    const intent = await this.classifyQueryIntent(question);
    const queryPlan = this.generateQueryPlan(intent, contextBudget);
    const followUpQuestions = this.suggestFollowUpQueries(question, queryPlan);
    const createdAt = new Date();

    try {
      await this.sql`
        INSERT INTO nlquery_sessions (
          session_id, workspace_id, question, intent, query_plan,
          follow_up_questions, created_at
        ) VALUES (
          ${sessionId}, ${workspaceId}, ${question},
          ${JSON.stringify(intent)}, ${JSON.stringify(queryPlan)},
          ${JSON.stringify(followUpQuestions)}, ${createdAt}
        )
      `;
    } catch (e) {
      logger.warn('Failed to persist NL query session', { sessionId, error: e });
    }

    logger.info('NL query processed', {
      sessionId,
      workspaceId,
      intentType: intent.type,
      confidence: intent.confidence,
    });

    return { sessionId, workspaceId, question, intent, queryPlan, followUpQuestions, createdAt };
  }

  /**
   * Records user feedback for a query session.
   * @param sessionId - The session to rate
   * @param helpful - Whether the result was helpful
   * @param notes - Optional free-text feedback
   */
  async recordFeedback(sessionId: string, helpful: boolean, notes?: string): Promise<void> {
    await this.sql`
      INSERT INTO nlquery_feedback (session_id, helpful, notes, created_at)
      VALUES (${sessionId}, ${helpful}, ${notes ?? null}, NOW())
      ON CONFLICT (session_id) DO UPDATE SET helpful = ${helpful}, notes = ${notes ?? null}
    `;
    logger.info('NL query feedback recorded', { sessionId, helpful });
  }

  /**
   * Returns paginated session history for a workspace.
   * @param workspaceId - Workspace scope
   * @param limit - Max sessions to return
   * @param cursor - Pagination cursor (session_id)
   * @returns Sessions and next cursor
   */
  async getSessionHistory(
    workspaceId: string,
    limit: number,
    cursor?: string
  ): Promise<{ sessions: NlQuerySession[]; nextCursor: string | null }> {
    const rows = cursor
      ? await this.sql<SessionRow[]>`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId} AND session_id < ${cursor}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `
      : await this.sql<SessionRow[]>`
          SELECT session_id, workspace_id, question, intent, query_plan,
                 follow_up_questions, created_at
          FROM nlquery_sessions
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC
          LIMIT ${limit + 1}
        `;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const sessions: NlQuerySession[] = page.map((r) => ({
      sessionId: r.session_id,
      workspaceId: r.workspace_id,
      question: r.question,
      intent: r.intent,
      queryPlan: r.query_plan,
      followUpQuestions: r.follow_up_questions,
      createdAt: r.created_at,
    }));

    return {
      sessions,
      nextCursor: hasMore ? page[page.length - 1]!.session_id : null,
    };
  }
}

function buildPlanExplanation(intent: QueryIntent, limit: number): string {
  const types = intent.entityTypes.join(', ');
  switch (intent.type) {
    case 'aggregation':
      return `Aggregate ${types} records with count and sum (up to ${limit}).`;
    case 'trend-analysis':
      return `Analyze ${types} trends over the last 30 days (up to ${limit} data points).`;
    case 'comparison':
      return `Compare ${types} groups with grouping and averaging (up to ${limit}).`;
    case 'metric-lookup':
      return `Look up metric values from ${types} (up to ${limit}).`;
    default:
      return `Search ${types} matching the query (up to ${limit} results).`;
  }
}
