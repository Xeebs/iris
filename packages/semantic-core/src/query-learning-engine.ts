import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-learning-engine' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type QueryHistoryEntry = {
  queryHash: string;
  queryText: string;
  entityTypesQueried: string[];
  filtersUsed: Record<string, unknown>;
  resultCount: number;
  success: boolean;
  executedAt: Date;
};

export type QueryPattern = {
  workspaceId: string;
  queryHash: string;
  entityTypesQueried: string[];
  filtersUsed: Record<string, unknown>;
  avgResultSize: number;
  successRate: number;
  occurrences: number;
  similarQueries: string[];
};

export type QuerySuggestion = {
  queryText: string;
  queryHash: string;
  confidence: number;
  reason: string;
  similarityScore: number;
};

export type MissingContextCandidate = {
  entityType: string;
  attribute: string;
  suggestionConfidence: number;
  useCase: string;
};

export type IndexExpansionRecommendation = {
  connectorType: string;
  entityTypes: string[];
  estimatedQueryCoverage: number;
  rationale: string;
};

/** Simple FNV-1a hash for query text. */
export function hashQuery(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Extract entity type tokens from a query string. */
function extractEntityTypes(query: string): string[] {
  const patterns: Record<string, string[]> = {
    contact: ['contact', 'contacts', 'person', 'people', 'customer', 'customers'],
    deal: ['deal', 'deals', 'opportunity', 'opportunities', 'pipeline'],
    company: ['company', 'companies', 'account', 'accounts', 'organization'],
    ticket: ['ticket', 'tickets', 'issue', 'issues', 'case', 'support'],
    lead: ['lead', 'leads', 'prospect', 'prospects'],
    activity: ['activity', 'activities', 'meeting', 'meetings', 'call', 'email'],
  };
  const lq = query.toLowerCase();
  return Object.entries(patterns)
    .filter(([, synonyms]) => synonyms.some(s => lq.includes(s)))
    .map(([type]) => type);
}

/** Jaccard similarity between two string arrays. */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Learns from a workspace's query history and upserts query patterns to the database.
 * @param sql - SQL function
 * @param workspaceId - Workspace to learn for
 * @param queryHistory - Recent successful and failed queries to analyze
 * @returns Number of patterns stored
 */
export async function learnFromSuccessfulQueries(
  sql: SqlFn,
  workspaceId: string,
  queryHistory: QueryHistoryEntry[],
): Promise<Result<number, Error>> {
  try {
    const successful = queryHistory.filter(q => q.success);
    if (successful.length === 0) return ok(0);

    const grouped = new Map<string, QueryHistoryEntry[]>();
    for (const entry of successful) {
      const key = entry.queryHash || hashQuery(entry.queryText);
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }

    let upserted = 0;
    for (const [queryHash, entries] of grouped) {
      const avgResultSize = Math.round(entries.reduce((s, e) => s + e.resultCount, 0) / entries.length);
      const entityTypes = [...new Set(entries.flatMap(e => e.entityTypesQueried.length > 0 ? e.entityTypesQueried : extractEntityTypes(e.queryText)))];
      const mergedFilters = Object.assign({}, ...entries.map(e => e.filtersUsed));
      const successRate = entries.filter(e => e.success).length / entries.length;

      await sql`
        INSERT INTO query_patterns
          (workspace_id, query_hash, entity_types_queried, filters_used, avg_result_size, success_rate, occurrences)
        VALUES (
          ${workspaceId}, ${queryHash},
          ${JSON.stringify(entityTypes)}, ${JSON.stringify(mergedFilters)},
          ${avgResultSize}, ${successRate}, ${entries.length}
        )
        ON CONFLICT (workspace_id, query_hash) DO UPDATE SET
          avg_result_size  = (query_patterns.avg_result_size * query_patterns.occurrences + EXCLUDED.avg_result_size) / (query_patterns.occurrences + EXCLUDED.occurrences),
          success_rate     = EXCLUDED.success_rate,
          occurrences      = query_patterns.occurrences + EXCLUDED.occurrences,
          filters_used     = EXCLUDED.filters_used
      `;
      upserted++;
    }

    log.info('Query patterns updated', { workspaceId, patternsUpserted: upserted });
    return ok(upserted);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Suggest related queries a user might want to run, based on patterns from this workspace.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param currentQuery - The query being executed now
 * @param limit - Max suggestions to return
 */
export async function suggestRelatedQueries(
  sql: SqlFn,
  workspaceId: string,
  currentQuery: string,
  limit = 5,
): Promise<Result<QuerySuggestion[], Error>> {
  try {
    const currentTypes = extractEntityTypes(currentQuery);

    const rows = await sql`
      SELECT query_hash, entity_types_queried, similar_queries, success_rate, occurrences
      FROM query_patterns
      WHERE workspace_id = ${workspaceId}
        AND success_rate >= 0.7
        AND occurrences >= 2
      ORDER BY occurrences DESC
      LIMIT 50
    ` as unknown as Array<{
      query_hash: string;
      entity_types_queried: string | string[];
      similar_queries: string | string[] | null;
      success_rate: number;
      occurrences: number;
    }>;

    const suggestions: QuerySuggestion[] = [];
    for (const row of rows) {
      const types = Array.isArray(row.entity_types_queried)
        ? row.entity_types_queried
        : JSON.parse(row.entity_types_queried as string) as string[];

      const similarity = jaccardSimilarity(currentTypes, types);
      if (similarity < 0.2 || row.query_hash === hashQuery(currentQuery)) continue;

      const similarQueries = row.similar_queries
        ? (Array.isArray(row.similar_queries) ? row.similar_queries : JSON.parse(row.similar_queries as string) as string[])
        : [];

      for (const qText of similarQueries.slice(0, 2)) {
        suggestions.push({
          queryText: qText,
          queryHash: row.query_hash,
          confidence: Math.round(similarity * row.success_rate * 100) / 100,
          reason: `Commonly run with ${types.join(', ')} queries (${row.occurrences}×)`,
          similarityScore: similarity,
        });
      }

      if (suggestions.length >= limit) break;
    }

    const ranked = suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return ok(ranked);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Suggest attributes that are frequently queried alongside the current entity type but absent from the given results.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param query - The current query
 * @param presentAttributes - Attribute names already in the result
 */
export async function suggestMissingContext(
  sql: SqlFn,
  workspaceId: string,
  query: string,
  presentAttributes: string[] = [],
): Promise<Result<MissingContextCandidate[], Error>> {
  try {
    const entityTypes = extractEntityTypes(query);
    if (entityTypes.length === 0) return ok([]);

    const rows = await sql`
      SELECT entity_type, attribute, suggestion_confidence, use_case
      FROM missing_context_candidates
      WHERE workspace_id = ${workspaceId}
        AND entity_type = ANY(${entityTypes})
        AND suggestion_confidence >= 0.5
      ORDER BY suggestion_confidence DESC
      LIMIT 10
    ` as unknown as Array<{
      entity_type: string;
      attribute: string;
      suggestion_confidence: number;
      use_case: string;
    }>;

    const missing = rows
      .filter(r => !presentAttributes.includes(r.attribute))
      .map(r => ({
        entityType: r.entity_type,
        attribute: r.attribute,
        suggestionConfidence: r.suggestion_confidence,
        useCase: r.use_case,
      }));

    return ok(missing);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Analyze workspace query patterns to recommend new connectors/entity types to onboard.
 * @param sql - SQL function
 * @param workspaceId - Workspace to analyze
 */
export async function recommendIndexExpansion(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<IndexExpansionRecommendation[], Error>> {
  try {
    const rows = await sql`
      SELECT entity_types_queried, SUM(occurrences) AS total_occurrences
      FROM query_patterns
      WHERE workspace_id = ${workspaceId}
      GROUP BY entity_types_queried
      ORDER BY total_occurrences DESC
      LIMIT 100
    ` as unknown as Array<{ entity_types_queried: string | string[]; total_occurrences: string }>;

    const typeCounts = new Map<string, number>();
    let totalOccurrences = 0;
    for (const row of rows) {
      const types = Array.isArray(row.entity_types_queried)
        ? row.entity_types_queried
        : JSON.parse(row.entity_types_queried as string) as string[];
      const count = parseInt(row.total_occurrences, 10);
      totalOccurrences += count;
      for (const t of types) {
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + count);
      }
    }

    const CONNECTOR_MAP: Record<string, { connector: string; entityTypes: string[] }> = {
      ticket: { connector: 'zendesk', entityTypes: ['ticket', 'customer'] },
      deal: { connector: 'salesforce', entityTypes: ['deal', 'opportunity', 'contact'] },
      activity: { connector: 'google-calendar', entityTypes: ['meeting', 'activity'] },
      company: { connector: 'linkedin', entityTypes: ['company', 'contact'] },
      lead: { connector: 'hubspot', entityTypes: ['lead', 'contact', 'deal'] },
    };

    const recommendations: IndexExpansionRecommendation[] = [];
    for (const [entityType, count] of typeCounts.entries()) {
      const mapping = CONNECTOR_MAP[entityType];
      if (!mapping) continue;
      const coverage = totalOccurrences > 0 ? count / totalOccurrences : 0;
      if (coverage < 0.05) continue;

      recommendations.push({
        connectorType: mapping.connector,
        entityTypes: mapping.entityTypes,
        estimatedQueryCoverage: Math.round(coverage * 100) / 100,
        rationale: `"${entityType}" appears in ${(coverage * 100).toFixed(0)}% of queries but may lack enriched data`,
      });
    }

    recommendations.sort((a, b) => b.estimatedQueryCoverage - a.estimatedQueryCoverage);
    log.info('Index expansion recommendations computed', { workspaceId, count: recommendations.length });
    return ok(recommendations.slice(0, 5));
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
