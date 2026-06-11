import { AzureOpenAI } from 'openai';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import { IndexerError } from '@iris/core/errors';
import { EMBEDDING_MODEL } from './embedding.js';
import { createDefaultProvider } from './embedding-provider.js';
import type { VectorStore } from './vector-store.js';
import { detectEntityTypes, expandQuery } from './query-decomposer.js';
import type { Result } from 'neverthrow';

/** Detected superlative/ranking intent for queries like "second largest deal". */
export type SuperlativeIntent = {
  /** Numeric attribute to sort by, e.g. 'amount' for deals, 'employees' for companies. */
  attribute: string;
  direction: 'largest' | 'smallest';
  /** 1-based rank: 1 = top result, 2 = second, etc. */
  rank: number;
};

/** Detected numeric filter condition for queries like "more than 200 employees". */
export type AttributeFilter = {
  attribute: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  value: number;
};

/**
 * Detect superlative ranking intent in a natural language query.
 * Returns null if the query contains no recognisable superlative pattern.
 *
 * @param query - Natural language query text
 * @returns Superlative intent if detected, null otherwise
 */
export function detectSuperlativeIntent(query: string): SuperlativeIntent | null {
  const q = query.toLowerCase();

  const isLargest = /\b(largest|biggest|highest|greatest|top|maximum|most)\b/.test(q);
  const isSmallest = /\b(smallest|lowest|minimum|cheapest|least expensive|fewest)\b/.test(q);
  if (!isLargest && !isSmallest) return null;

  const ordinalMap: Array<[RegExp, number]> = [
    [/\b(first|1st)\b/, 1],
    [/\b(second|2nd)\b/, 2],
    [/\b(third|3rd)\b/, 3],
    [/\b(fourth|4th)\b/, 4],
    [/\b(fifth|5th)\b/, 5],
  ];
  let rank = 1;
  for (const [pat, n] of ordinalMap) {
    if (pat.test(q)) { rank = n; break; }
  }

  let attribute = 'amount'; // default for deal queries
  if (/\bemploy(ee)?s?\b/.test(q)) attribute = 'employees';
  else if (/\brevenue\b/.test(q)) attribute = 'annual_revenue';

  return { attribute, direction: isSmallest ? 'smallest' : 'largest', rank };
}

/**
 * Detect a numeric attribute filter in a natural language query.
 * Returns null if no numeric comparison pattern is found.
 *
 * @param query - Natural language query text
 * @returns Attribute filter if detected, null otherwise
 */
export function detectAttributeFilter(query: string): AttributeFilter | null {
  const patterns: Array<[RegExp, '>' | '<' | '>=' | '<=' | '==']> = [
    [/\b(?:more than|greater than|over|above|exceed[s]?)\s+(\d[\d,]*)\b/i, '>'],
    [/\bat least\s+(\d[\d,]*)\b/i, '>='],
    [/\b(?:less than|fewer than|under|below)\s+(\d[\d,]*)\b/i, '<'],
    [/\bat most\s+(\d[\d,]*)\b/i, '<='],
    [/\bexactly\s+(\d[\d,]*)\b/i, '=='],
  ];

  for (const [pat, op] of patterns) {
    const m = query.match(pat);
    if (!m) continue;
    const numStr = m[m.length - 1]!.replace(/,/g, '');
    const value = parseInt(numStr, 10);
    if (isNaN(value)) continue;

    let attribute = 'amount';
    if (/\bemploy(ee)?s?\b/i.test(query)) attribute = 'employees';
    else if (/\brevenue\b/i.test(query)) attribute = 'annual_revenue';

    return { attribute, operator: op, value };
  }
  return null;
}

// Minimal graph interface — Neo4jGraphStore satisfies this via structural typing
interface RelatedEntityResult {
  id: string;
  type: string;
  label: string;
  relationshipType: string;
  workspaceId: string;
}

interface GraphExpander {
  getRelated(entityId: string, workspaceId: string, relType?: string, limit?: number): Promise<Result<RelatedEntityResult[], Error>>;
}

const log = logger.child({ service: 'retrieval' });

export interface RetrievalOptions {
  /** Workspace ID — enforced on every query to prevent cross-tenant data leaks */
  workspaceId: string;
  /** Maximum entities to return. Default: 10 */
  topK: number;
  /** Optionally filter by entity type (e.g., ['deal', 'contact']) — auto-detected when omitted */
  entityTypes?: string[];
  /** All entity types indexed in this workspace — used for auto-detection when entityTypes is unset */
  availableEntityTypes?: string[];
  /** Whether to expand results via relationship graph traversal. Default: true */
  expandRelationships: boolean;
  /** Max graph traversal depth. Default: 1 (direct relationships only) */
  maxDepth: number;
  /** OpenAI API key for query embedding and entity type detection */
  openAiApiKey?: string;
  /** Optional graph store for relationship expansion. When omitted, falls back to entity.relationships */
  graphStore?: GraphExpander;
  /** When true, use QueryDecomposer to auto-detect entity types from the query */
  autoDetectEntityTypes?: boolean;
  /**
   * When true, run BM25 lexical search in parallel with vector search and merge results
   * via Reciprocal Rank Fusion (RRF). Default: true if vectorStore supports bm25Search.
   */
  hybridSearch?: boolean;
  /** RRF rank constant k. Higher k reduces the impact of rank differences. Default: 60 */
  rrfK?: number;
  /**
   * Relative relevance floor: drop search results scoring below this fraction
   * of their list's top score, instead of always padding to topK. Applied to
   * the vector and BM25 lists separately, before RRF (RRF scores are
   * rank-based, so a relative cutoff is only meaningful per source list).
   * Reduces response tokens by excluding weakly-related entities.
   * 0 disables. Default: RETRIEVAL_RELEVANCE_CUTOFF env var, else 0.
   */
  relevanceCutoff?: number;
  /**
   * When true, calls expandQuery() to predict and prepend domain vocabulary to the query
   * before embedding. Requires openAiApiKey to be set. Default: false.
   */
  queryExpansion?: boolean;
  /** Postgres client for corpus frequency filtering during query expansion. */
  expansionSql?: import('postgres').Sql;
  /** Redis client for caching query expansion results (TTL: 1 hour). */
  expansionRedis?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
  };
}

export interface RetrievalResult {
  entities: SemanticEntity[];
  scores: number[];
  fromCache: boolean;
  queryEmbeddingMs: number;
  vectorSearchMs: number;
  graphExpansionMs: number;
}

export const DEFAULT_RETRIEVAL_OPTIONS: Omit<RetrievalOptions, 'workspaceId'> = {
  topK: 10,
  expandRelationships: true,
  maxDepth: 1,
};

/**
 * Resolve a logical attribute name to the actual key used in entity attributes.
 * Tries the exact name first, then the `_usd` suffix variant so that queries
 * for "amount" match entities that store values as "amount_usd", etc.
 *
 * @param entities - Candidate entities to probe for the attribute
 * @param attr     - Logical attribute name (e.g. 'amount', 'annual_revenue')
 * @returns The resolved attribute key to use for comparisons
 */
function resolveAttrKey(entities: SemanticEntity[], attr: string): string {
  if (entities.some((e) => e.attributes[attr] !== null && e.attributes[attr] !== undefined)) {
    return attr;
  }
  const usdVariant = `${attr}_usd`;
  if (entities.some((e) => e.attributes[usdVariant] !== null && e.attributes[usdVariant] !== undefined)) {
    return usdVariant;
  }
  return attr;
}

/**
 * Retrieve semantically relevant entities for a natural language query.
 * One embedding call per MCP request per embedding-patterns.md cost rules.
 *
 * @param query       - Natural language query from the AI tool
 * @param vectorStore - Initialized VectorStore for similarity search
 * @param options     - Retrieval configuration
 */
export async function retrieveContext(
  query: string,
  vectorStore: VectorStore,
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const opts = { ...DEFAULT_RETRIEVAL_OPTIONS, ...options };

  let embeddingInput = query;
  if (opts.queryExpansion && opts.openAiApiKey) {
    try {
      embeddingInput = await expandQuery(
        query,
        opts.workspaceId,
        opts.availableEntityTypes ?? [],
        opts.openAiApiKey,
        opts.expansionSql as import('postgres').Sql | undefined,
        opts.expansionRedis,
      );
      if (embeddingInput !== query) {
        log.debug('Query expanded for embedding', { workspaceId: opts.workspaceId });
      }
    } catch (e) {
      log.warn('Query expansion failed, using original query', { error: e });
    }
  }

  const embeddingStart = Date.now();
  const queryVector = await embedQuery(embeddingInput);
  const queryEmbeddingMs = Date.now() - embeddingStart;

  // Detect query intent so we can widen the candidate pool and post-filter.
  // Both detectors run upfront — results applied after expansion below.
  const superlativeIntent = detectSuperlativeIntent(query);
  const attributeFilter = detectAttributeFilter(query);
  // Widen the search pool 3× for aggregate/filter queries that need to scan
  // many entities to find the Nth-ranked or threshold-matching ones.
  const effectiveTopK =
    superlativeIntent || attributeFilter ? opts.topK * 3 : opts.topK;

  // Auto-detect entity types from the query when caller hasn't specified them
  let resolvedEntityTypes = opts.entityTypes;
  if (opts.autoDetectEntityTypes && resolvedEntityTypes === undefined && opts.availableEntityTypes) {
    const detected = await detectEntityTypes(query, opts.availableEntityTypes, opts.openAiApiKey);
    if (detected.length < opts.availableEntityTypes.length) {
      resolvedEntityTypes = detected;
      log.debug('Auto-detected entity types', { types: resolvedEntityTypes });
    }
  }

  const searchStart = Date.now();
  const vectorFilter = {
    workspaceId: opts.workspaceId,
    ...(resolvedEntityTypes !== undefined ? { entityTypes: resolvedEntityTypes } : {}),
  };

  const useHybrid = (opts.hybridSearch ?? true) && typeof vectorStore.bm25Search === 'function';
  const relevanceCutoff =
    opts.relevanceCutoff ?? Number(process.env['RETRIEVAL_RELEVANCE_CUTOFF'] ?? 0);

  let searchResults;
  if (useHybrid) {
    const [vectorResults, bm25Results] = await Promise.all([
      vectorStore.search(queryVector, effectiveTopK * 2, vectorFilter),
      vectorStore.bm25Search!(opts.workspaceId, query, effectiveTopK * 2, resolvedEntityTypes),
    ]);
    searchResults = reciprocalRankFusion(
      applyRelevanceCutoff(vectorResults, relevanceCutoff),
      applyRelevanceCutoff(bm25Results, relevanceCutoff),
      opts.rrfK ?? 60,
    ).slice(0, effectiveTopK);
    log.debug('Hybrid search: RRF merge complete', {
      vectorHits: vectorResults.length,
      bm25Hits: bm25Results.length,
      mergedHits: searchResults.length,
    });
  } else {
    searchResults = applyRelevanceCutoff(
      await vectorStore.search(queryVector, effectiveTopK, vectorFilter),
      relevanceCutoff,
    );
  }
  const vectorSearchMs = Date.now() - searchStart;

  const graphStart = Date.now();
  let expanded = searchResults.map((r) => r.entity);
  let scores = searchResults.map((r) => r.score);

  if (opts.expandRelationships && opts.maxDepth > 0) {
    const expandedResult = await expandViaRelationships(expanded, scores, vectorStore, opts);
    expanded = expandedResult.entities;
    scores = expandedResult.scores;
  }
  const graphExpansionMs = Date.now() - graphStart;

  // Post-process: superlative ranking (e.g. "second largest deal" → sort + slice)
  if (superlativeIntent) {
    const { attribute: rawAttr, direction, rank } = superlativeIntent;
    // Resolve the attribute key: try exact match first, then the _usd suffix variant
    // (postgres connectors often store monetary values as amount_usd, annual_revenue_usd, etc.)
    const attribute = resolveAttrKey(expanded, rawAttr);
    const candidates = expanded.filter(
      (e) => e.attributes[attribute] !== null &&
             e.attributes[attribute] !== undefined &&
             !isNaN(Number(e.attributes[attribute])),
    );
    candidates.sort((a, b) => {
      const av = Number(a.attributes[attribute]);
      const bv = Number(b.attributes[attribute]);
      return direction === 'largest' ? bv - av : av - bv;
    });
    const target = candidates[rank - 1];
    if (target) {
      expanded = [target];
      scores = [1.0];
      log.debug('Superlative post-sort applied', { attribute, direction, rank });
    }
  }

  // Post-process: numeric attribute filter (e.g. "companies with > 200 employees")
  if (attributeFilter && !superlativeIntent) {
    const { attribute, operator, value } = attributeFilter;
    const filtered = expanded.filter((e) => {
      const val = Number(e.attributes[attribute]);
      if (isNaN(val)) return false;
      switch (operator) {
        case '>':  return val >  value;
        case '<':  return val <  value;
        case '>=': return val >= value;
        case '<=': return val <= value;
        case '==': return val === value;
      }
    });
    if (filtered.length > 0) {
      expanded = filtered;
      scores = filtered.map(() => 0.7);
      log.debug('Attribute filter applied', { attribute, operator, value, matches: filtered.length });
    }
  }

  log.info('Retrieved context', {
    query: query.slice(0, 50),
    topK: opts.topK,
    resultsCount: expanded.length,
    queryEmbeddingMs,
    vectorSearchMs,
    graphExpansionMs,
  });

  return {
    entities: expanded,
    scores,
    fromCache: false,
    queryEmbeddingMs,
    vectorSearchMs,
    graphExpansionMs,
  };
}

async function embedQuery(query: string): Promise<number[]> {
  // Query and index embeddings must come from the same model, so an explicit
  // EMBEDDING_PROVIDER env (as set at index time, e.g. hash-deterministic in
  // demo mode) takes precedence over the legacy Azure path.
  if (process.env['EMBEDDING_PROVIDER']) {
    return createDefaultProvider().getEmbedding(query);
  }

  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const apiKey = process.env['AZURE_OPENAI_API_KEY'];
  const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2023-05-15';
  const deployment = process.env['AZURE_OPENAI_SMALL_DEPLOYMENT'] ?? 'text-embedding-3-small';

  if (!endpoint || !apiKey) {
    throw new IndexerError('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set');
  }

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });
  let response;
  try {
    response = await client.embeddings.create({ model: deployment, input: query });
  } catch (e) {
    throw new IndexerError(
      `Failed to embed query: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  return response.data[0]?.embedding ?? [];
}

/**
 * Drop results scoring below `cutoff × top score` of their own list.
 * Expects results sorted by descending score (as returned by the store).
 * A topK search always returns topK rows even when most are barely related;
 * weakly-related entities waste response tokens without answering the query.
 *
 * @param results - Ranked results from a single search source
 * @param cutoff  - Fraction of the top score to require (0 disables)
 * @returns Results above the relative floor (always keeps the top result)
 */
export function applyRelevanceCutoff(
  results: import('./vector-store.js').VectorSearchResult[],
  cutoff: number,
): import('./vector-store.js').VectorSearchResult[] {
  const top = results[0]?.score;
  if (cutoff <= 0 || top === undefined || top <= 0) return results;
  return results.filter((r, i) => i === 0 || r.score > top * cutoff);
}

async function expandViaRelationships(
  entities: SemanticEntity[],
  scores: number[],
  vectorStore: VectorStore,
  opts: RetrievalOptions,
): Promise<{ entities: SemanticEntity[]; scores: number[] }> {
  // seenIds starts empty for the interleaved path so that a contact that also
  // appears in the initial search list doesn't block reverse-expansion of its
  // parent company from placing it in the correct (earlier) position.
  // The graphStore path pre-populates seenIds since it pushes all entities
  // upfront before the expansion loop.
  const seenIds = new Set<string>();
  const expanded: SemanticEntity[] = [];
  const expandedScores: number[] = [];

  if (opts.graphStore) {
    // Preferred path: use the graph store to find related entity IDs, then fetch from vector store
    expanded.push(...entities);
    expandedScores.push(...scores);
    // Pre-populate seenIds so graph expansion doesn't re-add existing entities
    for (const e of entities) seenIds.add(e.id);

    for (const entity of entities) {
      const relResult = await opts.graphStore.getRelated(entity.id, opts.workspaceId);
      if (relResult.isErr()) {
        log.warn('Graph expansion failed for entity', { entityId: entity.id, error: relResult.error });
        continue;
      }

      for (const related of relResult.value) {
        if (seenIds.has(related.id)) continue;

        const found = await vectorStore.getById(opts.workspaceId, related.id);
        if (found) {
          expanded.push(found);
          expandedScores.push(0.5); // relationship-expanded entities get a fixed lower score
          seenIds.add(related.id);
        }
      }
    }
  } else {
    // Interleaved path: for each entity, emit it immediately followed by its
    // forward- and reverse-expanded neighbours. This ensures that when a
    // company ranks #1 (e.g. "contacts at Acme Corp"), its contacts appear at
    // positions 2-N rather than after all 20 initial results, keeping them
    // within the 2000-token context budget.
    //
    // seenIds is intentionally NOT pre-populated with all initial entity IDs.
    // Pre-populating would block reverse-expansion of a company from adding
    // a contact that also appears (lower-ranked) in the initial search results
    // — the contact would be placed at its search-rank position instead of
    // immediately after its parent company, and might fall outside the budget.
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;

      // Skip if already emitted (can happen when the same entity appears
      // in both forward-expansion of an earlier entity and the initial list).
      if (seenIds.has(entity.id)) continue;

      // Emit the entity itself
      seenIds.add(entity.id);
      expanded.push(entity);
      expandedScores.push(scores[i] ?? 0.5);

      // Forward expansion: entities referenced by this entity's FK relationships.
      // relationships round-trips through JSONB — tolerate malformed entries
      // (missing/non-string targetId) instead of poisoning the whole query:
      // postgres.js rejects undefined parameters with UNDEFINED_VALUE.
      const rels = Array.isArray(entity.relationships) ? entity.relationships : [];
      for (const rel of rels) {
        if (typeof rel?.targetId !== 'string' || rel.targetId.length === 0) {
          log.warn('Skipping malformed relationship during expansion', {
            entityId: entity.id,
            relationship: JSON.stringify(rel),
          });
          continue;
        }
        if (seenIds.has(rel.targetId)) continue;

        const found = await vectorStore.getById(opts.workspaceId, rel.targetId);
        if (found) {
          expanded.push(found);
          expandedScores.push(0.5);
          seenIds.add(rel.targetId);
        }
      }

      // Reverse expansion: entities that reference this entity (e.g., contacts at a company).
      if (vectorStore.getByRelationshipTarget) {
        const reverseRelated = await vectorStore.getByRelationshipTarget(opts.workspaceId, entity.id);
        for (const related of reverseRelated) {
          if (seenIds.has(related.id)) continue;
          expanded.push(related);
          expandedScores.push(0.5);
          seenIds.add(related.id);
        }
      }
    }
  }

  return { entities: expanded, scores: expandedScores };
}

/**
 * Reciprocal Rank Fusion — combine two ranked result lists into one.
 * score(d) = Σ 1/(k + rank(d)) over each list that contains d.
 * Results are sorted by combined score descending.
 *
 * @param listA - First ranked list (typically vector search)
 * @param listB - Second ranked list (typically BM25)
 * @param k     - RRF smoothing constant (default 60, from the original RRF paper)
 */
export function reciprocalRankFusion(
  listA: import('./vector-store.js').VectorSearchResult[],
  listB: import('./vector-store.js').VectorSearchResult[],
  k = 60,
): import('./vector-store.js').VectorSearchResult[] {
  const scores = new Map<string, number>();
  const entities = new Map<string, import('@iris/connector-sdk').SemanticEntity>();

  for (let i = 0; i < listA.length; i++) {
    const item = listA[i]!;
    const current = scores.get(item.entity.id) ?? 0;
    scores.set(item.entity.id, current + 1 / (k + i + 1));
    entities.set(item.entity.id, item.entity);
  }

  for (let i = 0; i < listB.length; i++) {
    const item = listB[i]!;
    const current = scores.get(item.entity.id) ?? 0;
    scores.set(item.entity.id, current + 1 / (k + i + 1));
    entities.set(item.entity.id, item.entity);
  }

  return Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ entity: entities.get(id)!, score }));
}
