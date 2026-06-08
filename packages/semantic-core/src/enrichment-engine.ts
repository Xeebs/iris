import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'enrichment-engine' });

/** Data returned by a single enrichment source for one entity. */
export interface EnrichmentData {
  source: string;
  data: Record<string, unknown>;
  confidenceScore: number;
  fetchedAt: Date;
  expiresAt: Date;
}

/** Plugin interface every enricher must implement. */
export interface EnrichmentSource {
  readonly sourceId: string;
  readonly name: string;
  /** Fetch enrichment for the given entity. Returns null if the source has no data. */
  fetchEnrichmentData(
    entityId: string,
    entityAttributes: Record<string, unknown>,
  ): Promise<EnrichmentData | null>;
}

export type EnrichmentTrigger = {
  entityType: string;
  sourceIds: string[];
};

export interface EnrichmentEngineConfig {
  /** Registered enrichment source plugins. */
  sources: EnrichmentSource[];
  /** Rules: which entity types should be enriched by which sources. */
  triggers: EnrichmentTrigger[];
  /** Storage backend for persisting enrichment results. */
  store: EnrichmentStore;
  /** Optional rate limiter factory returning a per-source token bucket. */
  rateLimiter?: (sourceId: string, rps: number) => RateLimiter;
  /** Max concurrent enrichment calls per source. Default: 3. */
  concurrency?: number;
}

export interface RateLimiter {
  acquire(): Promise<void>;
  release(): void;
}

/** Minimal storage interface for persisting enrichments. */
export interface EnrichmentStore {
  get(entityId: string, sourceId: string): Promise<EnrichmentData | null>;
  set(entityId: string, data: EnrichmentData): Promise<void>;
  getAll(entityId: string): Promise<EnrichmentData[]>;
  isStale(entityId: string, sourceId: string): Promise<boolean>;
  markRefreshTriggered(entityId: string, sourceId: string): Promise<void>;
}

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
    public readonly entityId: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

/**
 * Orchestrates background enrichment of SemanticEntity records from external data sources.
 * Enrichment is async and non-blocking — never called on the hot indexing path.
 */
export class EnrichmentEngine {
  private readonly sources: Map<string, EnrichmentSource>;
  private readonly triggers: EnrichmentTrigger[];
  private readonly store: EnrichmentStore;
  private readonly concurrency: number;

  constructor(private readonly config: EnrichmentEngineConfig) {
    this.sources = new Map(config.sources.map((s) => [s.sourceId, s]));
    this.triggers = config.triggers;
    this.store = config.store;
    this.concurrency = config.concurrency ?? 3;
  }

  /**
   * Enrich a single entity using all applicable sources based on trigger rules.
   * Results are persisted to the store. Errors per-source are logged; partial
   * success is acceptable.
   *
   * @param entity - Entity to enrich
   * @returns Map of sourceId → enrichment result or error
   */
  async enrichEntity(
    entity: SemanticEntity,
  ): Promise<Map<string, Result<EnrichmentData, EnrichmentError>>> {
    const applicableSourceIds = this.getApplicableSourceIds(entity.type);
    const results = new Map<string, Result<EnrichmentData, EnrichmentError>>();

    if (applicableSourceIds.length === 0) {
      return results;
    }

    const batches = chunk(applicableSourceIds, this.concurrency);
    for (const batch of batches) {
      await Promise.all(
        batch.map(async (sourceId) => {
          const result = await this.enrichFromSource(entity, sourceId);
          results.set(sourceId, result);
        }),
      );
    }

    log.info('Entity enrichment complete', {
      entityId: entity.id,
      entityType: entity.type,
      sourcesAttempted: applicableSourceIds.length,
      sourcesSucceeded: [...results.values()].filter((r) => r.isOk()).length,
    });

    return results;
  }

  /**
   * Bulk-enrich a list of entities. Entities without applicable triggers are skipped.
   *
   * @param entities - Entities to enrich
   * @returns Map of entityId → per-source results
   */
  async enrichBatch(
    entities: SemanticEntity[],
  ): Promise<Map<string, Map<string, Result<EnrichmentData, EnrichmentError>>>> {
    const allResults = new Map<string, Map<string, Result<EnrichmentData, EnrichmentError>>>();

    const entityBatches = chunk(entities, this.concurrency);
    for (const batch of entityBatches) {
      await Promise.all(
        batch.map(async (entity) => {
          const result = await this.enrichEntity(entity);
          if (result.size > 0) {
            allResults.set(entity.id, result);
          }
        }),
      );
    }

    return allResults;
  }

  /**
   * Refresh stale enrichment data for an entity. Only calls sources whose
   * cached data is expired or missing.
   *
   * @param entityId - Entity to refresh
   * @param entityAttributes - Current entity attributes
   * @param entityType - Type for trigger matching
   */
  async refreshEnrichment(
    entityId: string,
    entityAttributes: Record<string, unknown>,
    entityType: string,
  ): Promise<Result<void, EnrichmentError>> {
    const applicableSourceIds = this.getApplicableSourceIds(entityType);

    const staleSourceIds: string[] = [];
    await Promise.all(
      applicableSourceIds.map(async (sourceId) => {
        const stale = await this.store.isStale(entityId, sourceId);
        if (stale) staleSourceIds.push(sourceId);
      }),
    );

    if (staleSourceIds.length === 0) {
      return ok(undefined);
    }

    log.info('Refreshing stale enrichments', { entityId, staleSourceIds });

    const errors: EnrichmentError[] = [];
    await Promise.all(
      staleSourceIds.map(async (sourceId) => {
        const source = this.sources.get(sourceId);
        if (!source) return;

        try {
          await this.store.markRefreshTriggered(entityId, sourceId);
          const data = await source.fetchEnrichmentData(entityId, entityAttributes);
          if (data) {
            await this.store.set(entityId, data);
          }
        } catch (e) {
          errors.push(
            new EnrichmentError(
              e instanceof Error ? e.message : String(e),
              sourceId,
              entityId,
              true,
            ),
          );
        }
      }),
    );

    if (errors.length > 0 && errors[0]) {
      return err(errors[0]);
    }
    return ok(undefined);
  }

  /**
   * Retrieve all persisted enrichment data for an entity across all sources.
   *
   * @param entityId - Entity ID to look up
   */
  async getEnrichments(entityId: string): Promise<EnrichmentData[]> {
    return this.store.getAll(entityId);
  }

  /** Register a new enrichment source at runtime. */
  registerSource(source: EnrichmentSource): void {
    this.sources.set(source.sourceId, source);
    log.info('Enrichment source registered', { sourceId: source.sourceId });
  }

  private getApplicableSourceIds(entityType: string): string[] {
    const sourceIds = new Set<string>();
    for (const trigger of this.triggers) {
      if (trigger.entityType === entityType || trigger.entityType === '*') {
        for (const s of trigger.sourceIds) {
          if (this.sources.has(s)) sourceIds.add(s);
        }
      }
    }
    return [...sourceIds];
  }

  private async enrichFromSource(
    entity: SemanticEntity,
    sourceId: string,
  ): Promise<Result<EnrichmentData, EnrichmentError>> {
    const source = this.sources.get(sourceId);
    if (!source) {
      return err(new EnrichmentError(`Source ${sourceId} not found`, sourceId, entity.id, false));
    }

    const cached = await this.store.get(entity.id, sourceId).catch(() => null);
    if (cached) {
      log.debug('Enrichment cache hit', { entityId: entity.id, sourceId });
      return ok(cached);
    }

    try {
      const data = await source.fetchEnrichmentData(entity.id, entity.attributes as Record<string, unknown>);
      if (!data) {
        log.debug('Enrichment source returned no data', { entityId: entity.id, sourceId });
        return err(new EnrichmentError('No enrichment data available', sourceId, entity.id, false));
      }
      await this.store.set(entity.id, data);
      return ok(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('Enrichment source error', { entityId: entity.id, sourceId, error: msg });
      return err(new EnrichmentError(msg, sourceId, entity.id, true));
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
