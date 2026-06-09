import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-expansion-engine' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackMark = 'stale' | 'incomplete' | 'irrelevant' | 'useful';

export type ResultFeedback = {
  entityId: string;
  mark: FeedbackMark;
};

export type ExpandedResult = {
  entityId: string;
  entityType: string;
  label: string;
  score: number;
  stage: number;
};

export type ExpansionDirection = {
  axis: 'entity_type' | 'time_range' | 'attribute' | 'relationship';
  value: string;
  relevanceScore: number;
  reason: string;
};

export type ExpansionSession = {
  sessionId: string;
  query: string;
  stage: number;
  results: ExpandedResult[];
  directions: ExpansionDirection[];
  feedback: ResultFeedback[];
  createdAt: Date;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const FEEDBACK_WEIGHTS: Record<FeedbackMark, number> = {
  useful: 1.2,
  stale: 0.5,
  incomplete: 0.7,
  irrelevant: 0.1,
};

/**
 * Apply user feedback marks to adjust entity scores.
 * @param results - Current ranked results
 * @param feedback - User marks per entity
 * @returns Re-weighted results, sorted descending by adjusted score
 */
export function applyFeedbackWeights(results: ExpandedResult[], feedback: ResultFeedback[]): ExpandedResult[] {
  const fbMap = new Map(feedback.map((f) => [f.entityId, f.mark]));
  return results
    .map((r) => {
      const mark = fbMap.get(r.entityId);
      const weight = mark ? FEEDBACK_WEIGHTS[mark] : 1.0;
      return { ...r, score: r.score * weight };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Compute how relevant an expansion direction is for the original query.
 * Uses keyword overlap between query terms and the expansion value.
 * @param originalQuery - The user's original query string
 * @param expansionValue - The candidate expansion string
 * @returns Relevance score 0-1
 */
export function computeExpansionRelevance(originalQuery: string, expansionValue: string): number {
  if (!originalQuery || !expansionValue) return 0;
  const queryTokens = new Set(originalQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const expansionTokens = expansionValue.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (queryTokens.size === 0 || expansionTokens.length === 0) return 0.3;
  const hits = expansionTokens.filter((t) => queryTokens.has(t)).length;
  const baseScore = hits / expansionTokens.length;
  return Math.min(0.95, baseScore + 0.2); // floor of 0.2 for any expansion
}

/**
 * Score how negative a feedback mark is (0 = positive, 1 = fully negative).
 * Used to filter entity types that consistently receive bad feedback.
 * @param marks - Array of feedback marks for a set of results
 * @returns Negativity score 0-1
 */
export function scoreFeedbackNegativity(marks: FeedbackMark[]): number {
  if (marks.length === 0) return 0;
  const negativeWeights: Record<FeedbackMark, number> = { irrelevant: 1, stale: 0.6, incomplete: 0.4, useful: 0 };
  const totalNeg = marks.reduce((s, m) => s + negativeWeights[m], 0);
  return Math.min(1, totalNeg / marks.length);
}

/**
 * Extract likely expansion axes from a result set.
 * Returns deduplicated entity types and common attributes found.
 * @param results - Current result set
 * @returns Map of axis → values seen
 */
export function extractExpansionAxes(results: ExpandedResult[]): Map<string, string[]> {
  const axes = new Map<string, string[]>();
  const types = [...new Set(results.map((r) => r.entityType))];
  axes.set('entity_type', types);
  return axes;
}

// ─── QueryExpansionEngine ─────────────────────────────────────────────────────

export class QueryExpansionEngine {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Execute a query expansion, optionally re-ranking based on prior feedback.
   * @param query - User search query
   * @param stage - Expansion round (1 = initial, 2+ = iterative refinement)
   * @param feedback - Optional feedback from previous round to guide re-ranking
   * @returns Expanded and ranked results with a new session ID
   */
  async expandQuery(
    query: string,
    stage = 1,
    feedback: ResultFeedback[] | null = null,
  ): Promise<Result<ExpansionSession, Error>> {
    if (!query.trim()) return err(new Error('Query must not be empty'));
    try {
      type EntityRow = { id: string; type: string; label: string };
      const raw = await this.sql<EntityRow[]>`
        SELECT id, type, label FROM iris_entities
        WHERE to_tsvector('english', label) @@ plainto_tsquery('english', ${query})
           OR label ILIKE ${'%' + query + '%'}
        LIMIT 20
      `;

      let results: ExpandedResult[] = raw.map((e, i) => ({
        entityId: e.id,
        entityType: e.type,
        label: e.label,
        score: 1.0 - i * 0.04,
        stage,
      }));

      if (feedback && feedback.length > 0) {
        results = applyFeedbackWeights(results, feedback);
      }

      const directions = await this._suggestDirections(query, results);
      const sessionId = randomUUID();

      await this.sql`
        INSERT INTO query_expansion_sessions
          (id, query, stage, results_json, directions_json, feedback_json, created_at)
        VALUES (${sessionId}, ${query}, ${stage}, ${JSON.stringify(results)},
                ${JSON.stringify(directions)}, ${JSON.stringify(feedback ?? [])}, NOW())
      `;

      log.info('Query expanded', { sessionId, query, stage, resultCount: results.length });
      return ok({ sessionId, query, stage, results, directions, feedback: feedback ?? [], createdAt: new Date() });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest expansion directions based on current result set composition.
   * @param query - Original query
   * @param results - Current result set
   * @returns Ranked list of expansion suggestions
   */
  async suggestExpansionDirections(query: string, results: ExpandedResult[]): Promise<Result<ExpansionDirection[], Error>> {
    try {
      const directions = await this._suggestDirections(query, results);
      return ok(directions);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Refine a result set by applying user feedback marks without issuing a new search.
   * @param results - Current results
   * @param feedback - Feedback marks from the user
   * @returns Re-ranked results
   */
  async refineContextByFeedback(
    results: ExpandedResult[],
    feedback: ResultFeedback[],
  ): Promise<Result<ExpandedResult[], Error>> {
    if (results.length === 0) return err(new Error('results must not be empty'));
    if (feedback.length === 0) return ok(results);
    return ok(applyFeedbackWeights(results, feedback));
  }

  /**
   * Record user feedback for a specific expansion session.
   * @param sessionId - Session to attach feedback to
   * @param feedback - List of feedback marks
   */
  async recordFeedback(sessionId: string, feedback: ResultFeedback[]): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO expansion_feedback (id, session_id, feedback_json, recorded_at)
        VALUES (${randomUUID()}, ${sessionId}, ${JSON.stringify(feedback)}, NOW())
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve a previously computed expansion session.
   * @param sessionId - Session ID from expandQuery
   */
  async getSession(sessionId: string): Promise<Result<ExpansionSession, Error>> {
    try {
      type Row = { id: string; query: string; stage: number; results_json: string; directions_json: string; feedback_json: string; created_at: Date };
      const [row] = await this.sql<Row[]>`
        SELECT id, query, stage, results_json, directions_json, feedback_json, created_at
        FROM query_expansion_sessions WHERE id = ${sessionId}
      `;
      if (!row) return err(new Error(`Session ${sessionId} not found`));
      return ok({
        sessionId: row.id,
        query: row.query,
        stage: row.stage,
        results: JSON.parse(row.results_json) as ExpandedResult[],
        directions: JSON.parse(row.directions_json) as ExpansionDirection[],
        feedback: JSON.parse(row.feedback_json) as ResultFeedback[],
        createdAt: row.created_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async _suggestDirections(query: string, results: ExpandedResult[]): Promise<ExpansionDirection[]> {
    const axes = extractExpansionAxes(results);
    const directions: ExpansionDirection[] = [];

    for (const [axis, values] of axes) {
      for (const value of values.slice(0, 3)) {
        directions.push({
          axis: axis as ExpansionDirection['axis'],
          value,
          relevanceScore: computeExpansionRelevance(query, value),
          reason: `Filter by ${axis}: ${value}`,
        });
      }
    }

    directions.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return directions.slice(0, 5);
  }
}
