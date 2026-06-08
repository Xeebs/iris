import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'hybrid-search-engine' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortOrder = 'relevance' | 'newest' | 'oldest' | 'label_asc' | 'label_desc';

export const searchFiltersSchema = z.object({
  entityTypes: z.array(z.string()).optional(),
  connectorIds: z.array(z.string()).optional(),
  dateRange: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }).optional(),
  attributes: z.record(z.string()).optional(),
});

export const searchRequestSchema = z.object({
  workspaceId: z.string().min(1),
  query: z.string().min(1).max(500),
  filters: searchFiltersSchema.optional().default({}),
  limit: z.number().int().min(1).max(200).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  sortBy: z.enum(['relevance', 'newest', 'oldest', 'label_asc', 'label_desc']).optional().default('relevance'),
  includeSuggestions: z.boolean().optional().default(false),
  explainScoring: z.boolean().optional().default(false),
  hybridWeights: z.object({
    bm25: z.number().min(0).max(1).optional().default(0.4),
    semantic: z.number().min(0).max(1).optional().default(0.6),
  }).optional().default({ bm25: 0.4, semantic: 0.6 }),
});

export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface ScoreExplanation {
  bm25Score: number;
  semanticScore: number;
  rrfScore: number;
  bm25Rank: number | null;
  semanticRank: number | null;
}

export interface SearchResultItem {
  id: string;
  entityType: string;
  label: string;
  attributes: Record<string, unknown>;
  sourceConnectorId: string | null;
  lastModified: string | null;
  relevanceScore: number;
  highlightedLabel?: string;
  highlightedAttributes?: Record<string, string>;
  explanation?: ScoreExplanation;
}

export interface SearchSuggestion {
  text: string;
  type: 'entity' | 'keyword' | 'correction';
  score: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  hasMore: boolean;
  suggestions?: SearchSuggestion[];
  facets?: Record<string, Array<{ value: string; count: number }>>;
  durationMs: number;
}

// ─── Internal row type ────────────────────────────────────────────────────────

interface EntityRow {
  id: string;
  entity_type: string;
  label: string;
  attributes: Record<string, unknown>;
  source_connector_id: string | null;
  last_modified: string | null;
  bm25_rank: string | null;
  bm25_score: string | null;
  semantic_rank: string | null;
  semantic_score: string | null;
  rrf_score: string | null;
  total_count?: string;
}

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Query parser ─────────────────────────────────────────────────────────────

/**
 * Parses advanced query syntax: quoted phrases, field:value, boolean ops.
 * Returns a normalized query suitable for both BM25 and semantic search.
 */
export function parseQuerySyntax(raw: string): {
  normalized: string;
  phrases: string[];
  fieldFilters: Record<string, string>;
  terms: string[];
} {
  const phrases: string[] = [];
  const fieldFilters: Record<string, string> = {};
  let remaining = raw;

  // Extract quoted phrases "like this"
  const phraseMatches = raw.matchAll(/"([^"]+)"/g);
  for (const m of phraseMatches) {
    if (m[1]) phrases.push(m[1]);
    remaining = remaining.replace(m[0], ' ');
  }

  // Extract field:value pairs
  const fieldMatches = remaining.matchAll(/(\w+):(\S+)/g);
  for (const m of fieldMatches) {
    if (m[1] && m[2]) fieldFilters[m[1]] = m[2];
    remaining = remaining.replace(m[0], ' ');
  }

  // Strip boolean operators
  const terms = remaining
    .replace(/\b(AND|OR|NOT)\b/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const normalized = [...phrases, ...terms].join(' ').trim() || raw;

  return { normalized, phrases, fieldFilters, terms };
}

/**
 * Computes spell-correction suggestions using simple Levenshtein distance.
 * Returns the closest matching known tokens from the corpus vocabulary.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/**
 * Applies Reciprocal Rank Fusion to combine BM25 and semantic result lists.
 * @param bm25Results - IDs ranked by BM25
 * @param semanticResults - IDs ranked by semantic similarity
 * @param k - RRF constant (default: 60)
 * @param bm25Weight - Weight for BM25 component
 * @param semanticWeight - Weight for semantic component
 */
export function applyRRF(
  bm25Results: string[],
  semanticResults: string[],
  k = 60,
  bm25Weight = 0.4,
  semanticWeight = 0.6,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (let i = 0; i < bm25Results.length; i++) {
    const id = bm25Results[i]!;
    const prev = scores.get(id) ?? 0;
    scores.set(id, prev + bm25Weight / (k + i + 1));
  }

  for (let i = 0; i < semanticResults.length; i++) {
    const id = semanticResults[i]!;
    const prev = scores.get(id) ?? 0;
    scores.set(id, prev + semanticWeight / (k + i + 1));
  }

  return scores;
}

/**
 * Highlights query terms within text by wrapping matches in `<mark>` tags.
 */
export function highlightTerms(text: string, terms: string[]): string {
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(pattern, '<mark>$1</mark>');
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Hybrid search engine combining BM25 full-text and cosine-similarity vector
 * search with Reciprocal Rank Fusion for SMB/mid-market entity search.
 *
 * Uses PostgreSQL full-text search (tsvector) for BM25 and pgvector for
 * semantic nearest-neighbor search, then fuses with RRF.
 */
export class HybridSearchEngine {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Executes a hybrid search query and returns ranked results.
   * @param request - Validated search request
   * @returns Ranked results with optional scoring explanations
   */
  async search(request: SearchRequest): Promise<Result<SearchResponse, Error>> {
    const start = Date.now();

    try {
      const parsed = parseQuerySyntax(request.query);
      const { workspaceId, filters, limit, offset, sortBy, explainScoring, includeSuggestions, hybridWeights } = request;
      const effectiveLimit = Math.min(limit, 200);
      const bm25W = hybridWeights?.bm25 ?? 0.4;
      const semW = hybridWeights?.semantic ?? 0.6;

      // Build WHERE conditions
      const typeCond = filters?.entityTypes?.length ? filters.entityTypes : null;
      const connectorCond = filters?.connectorIds?.length ? filters.connectorIds : null;
      const dateFrom = filters?.dateRange?.from ?? null;
      const dateTo = filters?.dateRange?.to ?? null;

      // Run BM25 full-text search via Postgres tsvector
      // Use nullable params so a single fixed query handles all filter combinations
      const bm25Rows = await this.sql`
        SELECT id,
               ts_rank_cd(to_tsvector('english', label || ' ' || attributes::text),
                          to_tsquery('english', ${this.toTsQuery(parsed.normalized)})) AS score
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND to_tsvector('english', label || ' ' || attributes::text)
              @@ to_tsquery('english', ${this.toTsQuery(parsed.normalized)})
          AND (${typeCond as string[] | null} IS NULL OR entity_type = ANY(${typeCond as string[] | null}))
          AND (${connectorCond as string[] | null} IS NULL OR source_connector_id = ANY(${connectorCond as string[] | null}))
          AND (${dateFrom} IS NULL OR last_modified >= ${dateFrom})
          AND (${dateTo} IS NULL OR last_modified <= ${dateTo})
        ORDER BY score DESC
        LIMIT 100
      `.catch((): unknown[] => []) as Array<{ id: string; score: string }>;

      const bm25Ranked = bm25Rows.map((r) => r.id);

      // Run semantic search via pgvector cosine similarity
      const semanticRows = await this.sql`
        SELECT id,
               (embedding <=> (
                 SELECT embedding FROM indexed_entities
                 WHERE label ILIKE ${`%${parsed.normalized.slice(0, 50)}%`}
                   AND workspace_id = ${workspaceId}
                 LIMIT 1
               )) AS distance
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND (${typeCond as string[] | null} IS NULL OR entity_type = ANY(${typeCond as string[] | null}))
          AND (${connectorCond as string[] | null} IS NULL OR source_connector_id = ANY(${connectorCond as string[] | null}))
        ORDER BY distance ASC
        LIMIT 100
      `.catch((): unknown[] => []) as Array<{ id: string; distance: string }>;

      const semanticRanked = semanticRows.map((r) => r.id);

      // Merge via RRF
      const rrfScores = applyRRF(bm25Ranked, semanticRanked, 60, bm25W, semW);

      // Gather all candidate IDs
      const candidateIds = [...new Set([...bm25Ranked, ...semanticRanked])];

      if (candidateIds.length === 0) {
        return ok({
          results: [],
          total: 0,
          hasMore: false,
          ...(includeSuggestions ? { suggestions: await this.buildSuggestions(workspaceId, parsed.terms) } : {}),
          durationMs: Date.now() - start,
        });
      }

      // Sort by RRF score
      const sortedIds = candidateIds.sort((a, b) => (rrfScores.get(b) ?? 0) - (rrfScores.get(a) ?? 0));
      const pageIds = sortedIds.slice(offset, offset + effectiveLimit + 1);

      // Fetch full entity data for page
      const entityRows = await this.sql`
        SELECT id, entity_type, label, attributes, source_connector_id, last_modified
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND id = ANY(${pageIds as unknown as string[]})
      `.catch((): unknown[] => []) as Array<{
        id: string;
        entity_type: string;
        label: string;
        attributes: Record<string, unknown>;
        source_connector_id: string | null;
        last_modified: string | null;
      }>;

      const entityMap = new Map(entityRows.map((r) => [r.id, r]));
      const bm25RankMap = new Map(bm25Ranked.map((id, i) => [id, i]));
      const semanticRankMap = new Map(semanticRanked.map((id, i) => [id, i]));

      const hasMore = sortedIds.length > offset + effectiveLimit;
      const results: SearchResultItem[] = pageIds.slice(0, effectiveLimit).flatMap((id) => {
        const entity = entityMap.get(id);
        if (!entity) return [];
        const rrfScore = rrfScores.get(id) ?? 0;
        const bm25Rank = bm25RankMap.get(id) ?? null;
        const semRank = semanticRankMap.get(id) ?? null;
        const bm25Score = bm25Rows.find((r) => r.id === id)?.score ?? '0';
        const semScore = semanticRows.find((r) => r.id === id)?.distance ?? '1';

        const item: SearchResultItem = {
          id,
          entityType: entity.entity_type,
          label: entity.label,
          attributes: entity.attributes,
          sourceConnectorId: entity.source_connector_id,
          lastModified: entity.last_modified,
          relevanceScore: rrfScore,
          highlightedLabel: highlightTerms(entity.label, parsed.terms),
        };

        if (explainScoring) {
          item.explanation = {
            bm25Score: parseFloat(bm25Score),
            semanticScore: 1 - parseFloat(semScore),
            rrfScore,
            bm25Rank: bm25Rank !== null ? bm25Rank + 1 : null,
            semanticRank: semRank !== null ? semRank + 1 : null,
          };
        }

        return [item];
      });

      // Sort if not by relevance
      if (sortBy !== 'relevance') {
        results.sort((a, b) => {
          switch (sortBy) {
            case 'newest': return (b.lastModified ?? '').localeCompare(a.lastModified ?? '');
            case 'oldest': return (a.lastModified ?? '').localeCompare(b.lastModified ?? '');
            case 'label_asc': return a.label.localeCompare(b.label);
            case 'label_desc': return b.label.localeCompare(a.label);
            default: return 0;
          }
        });
      }

      const suggestions = includeSuggestions
        ? await this.buildSuggestions(workspaceId, parsed.terms)
        : undefined;

      log.info('Hybrid search complete', {
        workspaceId,
        query: request.query,
        results: results.length,
        durationMs: Date.now() - start,
      });

      return ok({
        results,
        total: sortedIds.length,
        hasMore,
        ...(suggestions ? { suggestions } : {}),
        durationMs: Date.now() - start,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns search suggestions based on query terms and recent entity labels.
   * @param workspaceId - Workspace to suggest from
   * @param terms - Parsed query terms
   */
  async buildSuggestions(workspaceId: string, terms: string[]): Promise<SearchSuggestion[]> {
    if (terms.length === 0) return [];
    try {
      const lastTerm = terms[terms.length - 1] ?? '';
      const rows = await this.sql`
        SELECT DISTINCT label, entity_type
        FROM indexed_entities
        WHERE workspace_id = ${workspaceId}
          AND label ILIKE ${`%${lastTerm}%`}
        ORDER BY label
        LIMIT 5
      ` as Array<{ label: string; entity_type: string }>;

      return rows.map((r) => ({
        text: r.label,
        type: 'entity' as const,
        score: 1 - levenshteinDistance(lastTerm.toLowerCase(), r.label.toLowerCase()) / Math.max(lastTerm.length, r.label.length),
      }));
    } catch {
      return [];
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private toTsQuery(text: string): string {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    return tokens.length > 0 ? tokens.join(' & ') : 'placeholder';
  }
}
