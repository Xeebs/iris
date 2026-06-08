import { createHash } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';
import type { AttributeValue } from '@iris/connector-sdk';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ service: 'attribute-frequency' });

/** Attributes shared by more than this fraction of same-type entities are non-discriminative. */
export const FREQUENCY_THRESHOLD = 0.6;

const MAX_CACHE_SIZE = 1000;

function hashValue(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function cacheKey(workspaceId: string, entityType: string, attrKey: string, valueHash: string): string {
  return `${workspaceId}:${entityType}:${attrKey}:${valueHash}`;
}

/**
 * Tracks attribute value frequency within a workspace to identify non-discriminative attributes.
 * Attributes that appear in >60% of same-type entities are filtered from embedding inputs to
 * improve semantic signal per the SIRA corpus-discriminative filtering approach.
 */
export class AttributeFrequencyTracker {
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly sql: SqlClient) {}

  /**
   * Record attribute values from a batch of entities of the same type.
   * Updates occurrence_count and frequency_ratio for each attribute key/value pair.
   *
   * @param workspaceId - Workspace containing the entities
   * @param entityType  - Entity type (e.g., 'contact', 'deal')
   * @param batchAttrs  - Array of attribute maps from each entity in the batch
   * @param batchTotal  - Total entity count for this type in the workspace
   */
  async recordAttributes(
    workspaceId: string,
    entityType: string,
    batchAttrs: Array<Record<string, AttributeValue>>,
    batchTotal: number,
  ): Promise<void> {
    if (batchAttrs.length === 0) return;

    // Count occurrences per attribute key/value pair in this batch
    const counts = new Map<string, { attrKey: string; valueHash: string; count: number }>();
    for (const attrs of batchAttrs) {
      for (const [key, val] of Object.entries(attrs)) {
        if (val === null) continue;
        const strVal = Array.isArray(val) ? val.join(',') : String(val);
        const hash = hashValue(strVal);
        const k = `${key}::${hash}`;
        const existing = counts.get(k);
        if (existing) {
          existing.count++;
        } else {
          counts.set(k, { attrKey: key, valueHash: hash, count: 1 });
        }
      }
    }

    if (counts.size === 0) return;

    const rows = Array.from(counts.values()).map(({ attrKey, valueHash, count }) => ({
      workspace_id: workspaceId,
      entity_type: entityType,
      attr_key: attrKey,
      attr_value_hash: valueHash,
      occurrence_count: count,
      total_entities: batchTotal,
      frequency_ratio: batchTotal > 0 ? count / batchTotal : 0,
    }));

    await this.sql`
      INSERT INTO entity_attribute_frequency
        (workspace_id, entity_type, attr_key, attr_value_hash, occurrence_count, total_entities, frequency_ratio, updated_at)
      SELECT
        workspace_id, entity_type, attr_key, attr_value_hash,
        occurrence_count, total_entities, frequency_ratio, now()
      FROM ${this.sql(rows)}
      ON CONFLICT (workspace_id, entity_type, attr_key, attr_value_hash)
      DO UPDATE SET
        occurrence_count = entity_attribute_frequency.occurrence_count + EXCLUDED.occurrence_count,
        total_entities   = EXCLUDED.total_entities,
        frequency_ratio  = (entity_attribute_frequency.occurrence_count + EXCLUDED.occurrence_count)::float
                           / NULLIF(EXCLUDED.total_entities, 0),
        updated_at       = now()
    `;

    // Evict stale cache entries for this workspace+type to force re-query
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${workspaceId}:${entityType}:`)) {
        this.cache.delete(key);
      }
    }

    log.debug('Recorded attribute frequency', {
      workspaceId,
      entityType,
      attributePairs: counts.size,
      totalEntities: batchTotal,
    });
  }

  /**
   * Check whether a specific attribute key+value is discriminative for a given entity type.
   * Returns true when the value appears in <= 60% of same-type entities.
   * Uses an in-memory LRU-style cache to avoid repeated DB queries.
   *
   * @param workspaceId - Workspace containing the entities
   * @param entityType  - Entity type (e.g., 'contact', 'deal')
   * @param attrKey     - Attribute key (e.g., 'stage', 'country')
   * @param attrValue   - Attribute value (will be hashed)
   */
  async isDiscriminative(
    workspaceId: string,
    entityType: string,
    attrKey: string,
    attrValue: string,
  ): Promise<boolean> {
    const hash = hashValue(attrValue);
    const key = cacheKey(workspaceId, entityType, attrKey, hash);

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const rows = await this.sql<{ frequency_ratio: number }[]>`
      SELECT frequency_ratio
      FROM entity_attribute_frequency
      WHERE workspace_id = ${workspaceId}
        AND entity_type = ${entityType}
        AND attr_key = ${attrKey}
        AND attr_value_hash = ${hash}
      LIMIT 1
    `;

    const ratio = rows[0]?.frequency_ratio ?? 0;
    const discriminative = ratio <= FREQUENCY_THRESHOLD;

    this.evictIfFull();
    this.cache.set(key, discriminative);

    return discriminative;
  }

  /**
   * Warm the cache for a list of entity type / attribute combinations.
   * Call once per batch before using isDiscriminativeSync to avoid DB round-trips.
   *
   * @param workspaceId - Workspace to query
   * @param entityType  - Entity type to warm
   * @param attrKeys    - Attribute keys to pre-fetch (all values)
   */
  async warmCache(workspaceId: string, entityType: string, attrKeys: string[]): Promise<void> {
    if (attrKeys.length === 0) return;

    const rows = await this.sql<{ attr_key: string; attr_value_hash: string; frequency_ratio: number }[]>`
      SELECT attr_key, attr_value_hash, frequency_ratio
      FROM entity_attribute_frequency
      WHERE workspace_id = ${workspaceId}
        AND entity_type = ${entityType}
        AND attr_key = ANY(${attrKeys})
    `;

    for (const row of rows) {
      const key = cacheKey(workspaceId, entityType, row.attr_key, row.attr_value_hash);
      this.evictIfFull();
      this.cache.set(key, row.frequency_ratio <= FREQUENCY_THRESHOLD);
    }
  }

  /**
   * Synchronous check using cached data only.
   * Unknown entries are assumed discriminative (i.e., not filtered).
   * Call warmCache() first to populate the cache for the batch.
   */
  isDiscriminativeSync(workspaceId: string, entityType: string, attrKey: string, attrValue: string): boolean {
    const hash = hashValue(attrValue);
    const key = cacheKey(workspaceId, entityType, attrKey, hash);
    return this.cache.get(key) ?? true;
  }

  private evictIfFull(): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
