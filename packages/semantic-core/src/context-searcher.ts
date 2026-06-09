import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'context-searcher' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndexedResponse = {
  responseId: string;
  workspaceId: string;
  entities: SemanticEntity[];
  indexedAt: Date;
  expiresAt: Date;
};

export type SearchMatch = {
  matchId: string;
  responseId: string;
  entity: SemanticEntity;
  score: number;
  matchingFields: string[];
  rank: number;
};

export type ExplainMatch = {
  matchId: string;
  entityId: string;
  entityType: string;
  score: number;
  matchingFields: Array<{
    fieldName: string;
    fieldValue: unknown;
    highlight: string;
  }>;
  reason: string;
};

// ─── Text similarity utilities ────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildEntityText(entity: SemanticEntity): string {
  const parts = [entity.type, entity.label];
  for (const [k, v] of Object.entries(entity.attributes)) {
    if (v !== null && v !== undefined) {
      parts.push(`${k}: ${Array.isArray(v) ? v.join(' ') : String(v)}`);
    }
  }
  return parts.join(' ');
}

function findMatchingFields(entity: SemanticEntity, queryTokens: Set<string>): string[] {
  const matching: string[] = [];

  if (queryTokens.size === 0) return [];

  const labelTokens = tokenize(entity.label);
  if ([...queryTokens].some((t) => labelTokens.has(t))) matching.push('label');

  for (const [field, value] of Object.entries(entity.attributes)) {
    if (value === null || value === undefined) continue;
    const fieldTokens = tokenize(String(Array.isArray(value) ? value.join(' ') : value));
    if ([...queryTokens].some((t) => fieldTokens.has(t))) matching.push(field);
  }

  return matching;
}

// ─── ContextSearcher ─────────────────────────────────────────────────────────

export class ContextSearcher {
  private readonly index: Map<string, IndexedResponse> = new Map();
  private readonly DEFAULT_TTL_SECONDS = 3600;

  /**
   * Index an MCP response's entity context for searching.
   * @param responseId - Unique identifier for this MCP response
   * @param workspaceId - Workspace scope
   * @param entities - Entities returned in the MCP response
   * @param ttlSeconds - Cache TTL in seconds
   */
  indexMcpResponse(
    responseId: string,
    workspaceId: string,
    entities: SemanticEntity[],
    ttlSeconds = this.DEFAULT_TTL_SECONDS,
  ): void {
    const now = new Date();
    this.index.set(responseId, {
      responseId,
      workspaceId,
      entities,
      indexedAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
    log.debug('MCP response indexed', { responseId, entityCount: entities.length, ttlSeconds });
  }

  /**
   * Search within a previously indexed MCP response context.
   * @param responseId - Response to search within
   * @param searchQuery - Natural language search query
   * @param limit - Max results to return
   * @returns Ranked array of SearchMatch
   */
  searchWithinContext(responseId: string, searchQuery: string, limit = 10): SearchMatch[] {
    const indexed = this.index.get(responseId);
    if (!indexed) {
      log.warn('Response not found in index', { responseId });
      return [];
    }

    if (indexed.expiresAt <= new Date()) {
      this.index.delete(responseId);
      log.warn('Response index expired', { responseId });
      return [];
    }

    const queryTokens = tokenize(searchQuery);
    const scored = indexed.entities.map((entity) => {
      const entityText = buildEntityText(entity);
      const entityTokens = tokenize(entityText);
      const score = jaccardSimilarity(queryTokens, entityTokens);
      const matchingFields = findMatchingFields(entity, queryTokens);
      return { entity, score, matchingFields };
    });

    const ranked = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s, i) => ({
        matchId: `${responseId}:${s.entity.id}:${i}`,
        responseId,
        entity: s.entity,
        score: Math.round(s.score * 1000) / 1000,
        matchingFields: s.matchingFields,
        rank: i + 1,
      }));

    log.debug('Context search completed', { responseId, query: searchQuery, resultCount: ranked.length });
    return ranked;
  }

  /**
   * Explain why a match ranked highly for a given search query.
   * @param matchId - Match identifier from searchWithinContext result
   * @param responseId - Response that was searched
   * @param searchQuery - The query that produced this match
   * @returns ExplainMatch with highlighted field matches
   */
  explainMatch(responseId: string, entityId: string, searchQuery: string): ExplainMatch | null {
    const indexed = this.index.get(responseId);
    if (!indexed) return null;

    const entity = indexed.entities.find((e) => e.id === entityId);
    if (!entity) return null;

    const queryTokens = tokenize(searchQuery);
    const matchingFields: ExplainMatch['matchingFields'] = [];

    // Check label
    const labelTokens = tokenize(entity.label);
    const labelMatches = [...queryTokens].filter((t) => labelTokens.has(t));
    if (labelMatches.length > 0) {
      matchingFields.push({
        fieldName: 'label',
        fieldValue: entity.label,
        highlight: labelMatches.join(', '),
      });
    }

    // Check attributes
    for (const [field, value] of Object.entries(entity.attributes)) {
      if (value === null || value === undefined) continue;
      const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
      const fieldTokens = tokenize(displayValue);
      const hits = [...queryTokens].filter((t) => fieldTokens.has(t));
      if (hits.length > 0) {
        matchingFields.push({
          fieldName: field,
          fieldValue: value,
          highlight: hits.join(', '),
        });
      }
    }

    const entityText = buildEntityText(entity);
    const entityTokens = tokenize(entityText);
    const score = Math.round(jaccardSimilarity(queryTokens, entityTokens) * 1000) / 1000;

    return {
      matchId: `${responseId}:${entityId}`,
      entityId,
      entityType: entity.type,
      score,
      matchingFields,
      reason: `Matched ${matchingFields.length} field(s) with query tokens: ${[...queryTokens].join(', ')}`,
    };
  }

  /**
   * Check if a response is currently indexed.
   * @param responseId - Response to check
   */
  isIndexed(responseId: string): boolean {
    const indexed = this.index.get(responseId);
    if (!indexed) return false;
    if (indexed.expiresAt <= new Date()) {
      this.index.delete(responseId);
      return false;
    }
    return true;
  }

  /**
   * Remove a response from the index.
   * @param responseId - Response to evict
   */
  evict(responseId: string): boolean {
    return this.index.delete(responseId);
  }

  /**
   * Return summary stats about the in-memory index.
   */
  getIndexStats(): { totalResponses: number; totalEntities: number } {
    const now = new Date();
    let total = 0;
    let entities = 0;
    for (const [id, r] of this.index) {
      if (r.expiresAt > now) {
        total++;
        entities += r.entities.length;
      } else {
        this.index.delete(id);
      }
    }
    return { totalResponses: total, totalEntities: entities };
  }
}
