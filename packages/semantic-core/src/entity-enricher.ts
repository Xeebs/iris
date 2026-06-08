import OpenAI from 'openai';
import { createHash } from 'crypto';
import type postgres from 'postgres';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'entity-enricher' });

type SqlClient = ReturnType<typeof postgres>;

/** Redis-compatible interface for enrichment caching. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
}

const ENRICHMENT_OVER_THRESHOLD = 0.7;
const ENRICHMENT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function entityContentHash(entity: SemanticEntity): string {
  const content = JSON.stringify({
    id: entity.id,
    type: entity.type,
    label: entity.label,
    attributes: entity.attributes,
  });
  return createHash('sha1').update(content).digest('hex').slice(0, 20);
}

/**
 * Enriches entities at index time with LLM-predicted search vocabulary.
 * Improves recall for natural language queries that use different terminology
 * than the raw entity data (e.g., "Q3-ENT-2204" → "enterprise ticket Q3 bug sprint").
 *
 * Based on the corpus-side enrichment technique from the SIRA paper.
 */
export class EntityEnricher {
  constructor(
    private readonly openAiApiKey: string,
    private readonly sql?: SqlClient,
    private readonly redis?: RedisLike,
  ) {}

  /**
   * Predict 5–10 additional search terms a user might use to find this entity.
   * Returns deduplicated terms filtered against corpus frequency (drops terms >70% occurrence).
   * Results are cached by entity content hash in Redis (TTL: 7 days).
   *
   * @param entity - Entity to enrich
   * @param workspaceId - Workspace for frequency filtering
   * @returns Array of predicted search terms
   */
  async enrichEntity(entity: SemanticEntity, workspaceId: string): Promise<string[]> {
    const contentHash = entityContentHash(entity);
    const redisKey = `iris:enrich:${workspaceId}:${contentHash}`;

    if (this.redis) {
      const cached = await this.redis.get(redisKey).catch(() => null);
      if (cached !== null) {
        log.debug('Entity enrichment cache hit', { entityId: entity.id, workspaceId });
        return JSON.parse(cached) as string[];
      }
    }

    const rawTerms = await this.predictTerms(entity);
    const filtered = this.sql
      ? await this.filterByFrequency(rawTerms, workspaceId, entity.type)
      : rawTerms;

    const deduped = [...new Set(filtered)];

    if (this.redis && deduped.length > 0) {
      await this.redis
        .set(redisKey, JSON.stringify(deduped), 'EX', ENRICHMENT_CACHE_TTL_SECONDS)
        .catch(() => undefined);
    }

    log.debug('Entity enriched', {
      entityId: entity.id,
      workspaceId,
      rawTermCount: rawTerms.length,
      filteredTermCount: deduped.length,
    });

    return deduped;
  }

  private async predictTerms(entity: SemanticEntity): Promise<string[]> {
    const client = new OpenAI({ apiKey: this.openAiApiKey });

    const attrSummary = Object.entries(entity.attributes)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : String(v)}`)
      .join('; ');

    const prompt = [
      `Entity type: ${entity.type}`,
      `Label: ${entity.label}`,
      `Attributes: ${attrSummary || 'none'}`,
      'Predict 5–10 additional search terms a user might use to find this entity.',
      'Include synonyms, abbreviations, related concepts, and domain jargon.',
      'Return a JSON array of lowercase strings only. Example: ["bug", "sprint", "backlog", "Q3", "enterprise"]',
      'Return only the JSON array, nothing else.',
    ].join('\n');

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 150,
      });
      const text = response.choices[0]?.message.content ?? '[]';
      const jsonMatch = text.match(/\[.*?\]/s);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as unknown[];
      return parsed
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 1)
        .map((t) => t.trim().toLowerCase())
        .slice(0, 10);
    } catch (e) {
      log.warn('Entity enrichment LLM call failed', {
        entityId: entity.id,
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  private async filterByFrequency(
    terms: string[],
    workspaceId: string,
    entityType: string,
  ): Promise<string[]> {
    if (!this.sql || terms.length === 0) return terms;

    try {
      const rows = await this.sql<Array<{ attr_key: string; frequency_ratio: number }>>`
        SELECT attr_key, MAX(frequency_ratio) AS frequency_ratio
        FROM entity_attribute_frequency
        WHERE workspace_id = ${workspaceId}
          AND entity_type = ${entityType}
          AND attr_key = ANY(${terms})
        GROUP BY attr_key
      `;

      const overThreshold = new Set(
        rows
          .filter((r) => r.frequency_ratio > ENRICHMENT_OVER_THRESHOLD)
          .map((r) => r.attr_key),
      );

      return terms.filter((t) => !overThreshold.has(t));
    } catch (e) {
      log.warn('Enrichment frequency filter failed, returning unfiltered terms', {
        error: e instanceof Error ? e.message : String(e),
      });
      return terms;
    }
  }
}
