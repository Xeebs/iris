import { createHash } from 'crypto';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-analytics-engine' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryEvent {
  queryId: string;
  workspaceId: string;
  userId?: string;
  queryText: string;
  querySignature: string;
  entityTypes: string[];
  cacheHit: boolean;
  latencyMs: number;
  tokensSpent: number;
  timestamp: Date;
}

export type PatternType = 'temporal' | 'user' | 'entity_type';

export interface QueryPattern {
  workspaceId: string;
  patternType: PatternType;
  definition: PatternDefinition;
  confidenceScore: number;
  discoveredAt: Date;
}

export type PatternDefinition =
  | { type: 'temporal'; hourOfDay: number; dayOfWeek?: number; entityTypes: string[] }
  | { type: 'user'; userId: string; topEntityTypes: string[]; avgQueryInterval: number }
  | { type: 'entity_type'; entityType: string; peakHour: number; frequency: number };

export interface CacheWarmingJob {
  workspaceId: string;
  warmingJobId: string;
  triggerQuerySignatures: string[];
  executedAt: Date;
  cacheHitImprovementRate?: number;
}

export interface AnalyticsStore {
  recordEvent(event: QueryEvent): Promise<void>;
  getRecentEvents(workspaceId: string, limitHours?: number): Promise<QueryEvent[]>;
  getPatterns(workspaceId: string): Promise<QueryPattern[]>;
  savePattern(pattern: QueryPattern): Promise<void>;
  recordWarmingJob(job: CacheWarmingJob): Promise<void>;
  getTopSignatures(workspaceId: string, limit?: number): Promise<{ signature: string; count: number; lastSeen: Date }[]>;
}

// ---------------------------------------------------------------------------
// Query fingerprinting
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'in', 'of', 'to', 'with', 'is', 'are', 'was',
  'were', 'by', 'at', 'on', 'all', 'my', 'our', 'from', 'what', 'which', 'who', 'me',
  'show', 'find', 'get', 'give', 'list', 'fetch',
]);

const ENTITY_ALIASES: Record<string, string> = {
  contact: 'contact', contacts: 'contact', person: 'contact', people: 'contact',
  company: 'company', companies: 'company', account: 'company', accounts: 'company',
  deal: 'deal', deals: 'deal', opportunity: 'deal', opportunities: 'deal',
  ticket: 'ticket', tickets: 'ticket', issue: 'ticket', issues: 'ticket',
  meeting: 'meeting', meetings: 'meeting', event: 'meeting', call: 'meeting',
};

/**
 * Generate a stable fingerprint for a natural-language query.
 * Groups semantically similar queries (same intent, different wording) into one signature.
 * Used for cache lookup and pattern detection.
 *
 * @param queryText - Raw query string from the client
 * @returns SHA1 hex prefix (12 chars) of the normalized query
 */
export function computeQuerySignature(queryText: string): string {
  const normalized = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => ENTITY_ALIASES[t] ?? t)
    .sort()
    .join(' ');

  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Extract probable entity types from a query string.
 * Used to annotate query events and route to entity-type-specific warmers.
 *
 * @param queryText - Raw query string
 */
export function extractEntityTypes(queryText: string): string[] {
  const lower = queryText.toLowerCase();
  const found = new Set<string>();
  for (const [alias, canonical] of Object.entries(ENTITY_ALIASES)) {
    if (lower.includes(alias)) found.add(canonical);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine
// ---------------------------------------------------------------------------

/**
 * Tracks query patterns, predicts cache hits, and proactively warms the cache
 * for queries likely to be requested in the near future.
 */
export class QueryAnalyticsEngine {
  constructor(private readonly store: AnalyticsStore) {}

  /**
   * Record a completed query execution.
   *
   * @param workspaceId - Workspace that ran the query
   * @param queryText - The raw query string
   * @param cacheHit - Whether the response was served from cache
   * @param latencyMs - End-to-end latency
   * @param tokensSpent - Token count of the response
   * @param userId - Optional user identifier
   */
  async trackQuery(
    workspaceId: string,
    queryText: string,
    cacheHit: boolean,
    latencyMs: number,
    tokensSpent: number,
    userId?: string,
  ): Promise<void> {
    const event: QueryEvent = {
      queryId: createHash('sha256').update(`${workspaceId}:${Date.now()}:${queryText}`).digest('hex').slice(0, 16),
      workspaceId,
      queryText,
      querySignature: computeQuerySignature(queryText),
      entityTypes: extractEntityTypes(queryText),
      cacheHit,
      latencyMs,
      tokensSpent,
      timestamp: new Date(),
      ...(userId !== undefined && { userId }),
    };

    await this.store.recordEvent(event);

    log.debug('Query tracked', {
      workspaceId,
      signature: event.querySignature,
      cacheHit,
      latencyMs,
    });
  }

  /**
   * Analyse recent query history to discover temporal and user-behaviour patterns.
   * Saves newly discovered patterns to the store.
   *
   * @param workspaceId - Workspace to analyse
   * @param lookbackHours - How many hours of history to consider (default: 168 = 7 days)
   */
  async detectQueryPatterns(workspaceId: string, lookbackHours = 168): Promise<QueryPattern[]> {
    const events = await this.store.getRecentEvents(workspaceId, lookbackHours);
    if (events.length === 0) return [];

    const patterns: QueryPattern[] = [
      ...detectTemporalPatterns(workspaceId, events),
      ...detectUserPatterns(workspaceId, events),
      ...detectEntityTypePatterns(workspaceId, events),
    ];

    await Promise.all(patterns.map((p) => this.store.savePattern(p)));

    log.info('Query patterns detected', { workspaceId, patternCount: patterns.length });
    return patterns;
  }

  /**
   * Predict whether a given query is likely to produce a cache hit based on
   * the stored patterns for the workspace.
   *
   * @param workspaceId - Workspace context
   * @param queryText - Query to evaluate
   * @returns Score between 0 and 1 (higher = more likely to hit cache)
   */
  async predictCacheHit(workspaceId: string, queryText: string): Promise<number> {
    const signature = computeQuerySignature(queryText);
    const [topSigs, patterns] = await Promise.all([
      this.store.getTopSignatures(workspaceId, 200),
      this.store.getPatterns(workspaceId),
    ]);

    const sigEntry = topSigs.find((s) => s.signature === signature);
    if (!sigEntry) return 0;

    const frequencyScore = Math.min(sigEntry.count / 10, 1) * 0.6;

    const now = new Date();
    const currentHour = now.getHours();
    const temporalBoost = patterns
      .filter((p) => p.patternType === 'temporal')
      .reduce((boost, p) => {
        const def = p.definition as { type: 'temporal'; hourOfDay: number; entityTypes: string[] };
        if (Math.abs(def.hourOfDay - currentHour) <= 1) {
          return boost + 0.2 * p.confidenceScore;
        }
        return boost;
      }, 0);

    return Math.min(frequencyScore + Math.min(temporalBoost, 0.4), 1);
  }

  /**
   * Warm the cache for signatures predicted to be queried soon.
   * Returns the warming job record for audit purposes.
   *
   * @param workspaceId - Workspace to warm
   * @param executeWarming - Callback that actually executes each query to populate cache
   * @param predictionThreshold - Min score to warm (default: 0.6)
   */
  async warmCache(
    workspaceId: string,
    executeWarming: (signature: string) => Promise<void>,
    predictionThreshold = 0.6,
  ): Promise<CacheWarmingJob> {
    const topSigs = await this.store.getTopSignatures(workspaceId, 50);

    const candidates = topSigs.filter((s) => {
      const recencyScore = isRecent(s.lastSeen, 24) ? 0.3 : 0;
      const freqScore = Math.min(s.count / 10, 1) * 0.7;
      return freqScore + recencyScore >= predictionThreshold;
    });

    const signaturesWarmed: string[] = [];

    for (const candidate of candidates) {
      try {
        await executeWarming(candidate.signature);
        signaturesWarmed.push(candidate.signature);
      } catch (e) {
        log.warn('Cache warming failed for signature', {
          workspaceId,
          signature: candidate.signature,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const job: CacheWarmingJob = {
      workspaceId,
      warmingJobId: createHash('sha256').update(`${workspaceId}:${Date.now()}`).digest('hex').slice(0, 16),
      triggerQuerySignatures: signaturesWarmed,
      executedAt: new Date(),
    };

    await this.store.recordWarmingJob(job);

    log.info('Cache warming complete', {
      workspaceId,
      signaturesWarmed: signaturesWarmed.length,
      candidatesConsidered: candidates.length,
    });

    return job;
  }

  /**
   * Retrieve stored patterns for a workspace.
   *
   * @param workspaceId - Workspace to look up
   */
  async getPatterns(workspaceId: string): Promise<QueryPattern[]> {
    return this.store.getPatterns(workspaceId);
  }

  /**
   * Get top query signatures by frequency for a workspace.
   *
   * @param workspaceId - Workspace to look up
   * @param limit - Maximum number of signatures to return (default: 20)
   */
  async getTopSignatures(workspaceId: string, limit = 20) {
    return this.store.getTopSignatures(workspaceId, limit);
  }
}

// ---------------------------------------------------------------------------
// Pattern detection helpers
// ---------------------------------------------------------------------------

function detectTemporalPatterns(workspaceId: string, events: QueryEvent[]): QueryPattern[] {
  const hourBuckets = new Map<number, { entityTypes: Map<string, number>; count: number }>();

  for (const event of events) {
    const hour = event.timestamp.getHours();
    const bucket = hourBuckets.get(hour) ?? { entityTypes: new Map(), count: 0 };
    bucket.count++;
    for (const et of event.entityTypes) {
      bucket.entityTypes.set(et, (bucket.entityTypes.get(et) ?? 0) + 1);
    }
    hourBuckets.set(hour, bucket);
  }

  const avgCount = events.length / 24;
  const patterns: QueryPattern[] = [];

  for (const [hour, bucket] of hourBuckets) {
    if (bucket.count < avgCount * 1.5) continue;
    const topEntityTypes = [...bucket.entityTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([et]) => et);

    patterns.push({
      workspaceId,
      patternType: 'temporal',
      definition: { type: 'temporal', hourOfDay: hour, entityTypes: topEntityTypes },
      confidenceScore: Math.min(bucket.count / (avgCount * 3), 1),
      discoveredAt: new Date(),
    });
  }

  return patterns;
}

function detectUserPatterns(workspaceId: string, events: QueryEvent[]): QueryPattern[] {
  const userMap = new Map<string, QueryEvent[]>();

  for (const event of events) {
    if (!event.userId) continue;
    const userEvents = userMap.get(event.userId) ?? [];
    userEvents.push(event);
    userMap.set(event.userId, userEvents);
  }

  const patterns: QueryPattern[] = [];

  for (const [userId, userEvents] of userMap) {
    if (userEvents.length < 5) continue;

    const entityTypeCounts = new Map<string, number>();
    for (const e of userEvents) {
      for (const et of e.entityTypes) {
        entityTypeCounts.set(et, (entityTypeCounts.get(et) ?? 0) + 1);
      }
    }

    const topEntityTypes = [...entityTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([et]) => et);

    const sorted = [...userEvents].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const intervals = sorted
      .slice(1)
      .map((e, i) => e.timestamp.getTime() - sorted[i]!.timestamp.getTime());
    const avgQueryInterval = intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : 0;

    patterns.push({
      workspaceId,
      patternType: 'user',
      definition: { type: 'user', userId, topEntityTypes, avgQueryInterval },
      confidenceScore: Math.min(userEvents.length / 20, 1),
      discoveredAt: new Date(),
    });
  }

  return patterns;
}

function detectEntityTypePatterns(workspaceId: string, events: QueryEvent[]): QueryPattern[] {
  const etMap = new Map<string, number[]>();

  for (const event of events) {
    for (const et of event.entityTypes) {
      const hours = etMap.get(et) ?? [];
      hours.push(event.timestamp.getHours());
      etMap.set(et, hours);
    }
  }

  const patterns: QueryPattern[] = [];

  for (const [entityType, hours] of etMap) {
    if (hours.length < 3) continue;

    const hourCount = new Map<number, number>();
    for (const h of hours) hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
    const peakEntry = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!peakEntry) continue;

    patterns.push({
      workspaceId,
      patternType: 'entity_type',
      definition: {
        type: 'entity_type',
        entityType,
        peakHour: peakEntry[0],
        frequency: hours.length,
      },
      confidenceScore: Math.min(hours.length / 30, 1),
      discoveredAt: new Date(),
    });
  }

  return patterns;
}

function isRecent(date: Date, withinHours: number): boolean {
  return Date.now() - date.getTime() < withinHours * 60 * 60 * 1000;
}
