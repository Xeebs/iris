import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'insight-generator' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsightType =
  | 'anomaly'
  | 'trend'
  | 'outlier'
  | 'missing_data'
  | 'relationship'
  | 'pattern';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightGranularity = 'daily' | 'weekly';

export type GeneratedInsight = {
  id: string;
  entityType: string;
  insightType: InsightType;
  title: string;
  summary: string;
  affectedCount: number;
  severity: InsightSeverity;
  valueScore: number;
  evidence: string[];
  detectedAt: Date;
};

export type InsightReport = {
  entityType: string;
  granularity: InsightGranularity;
  generatedAt: Date;
  totalInsights: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  highlights: GeneratedInsight[];
};

export type ScheduledReport = {
  id: string;
  entityTypes: string[];
  frequency: InsightGranularity;
  recipients: string[];
  lastRunAt: Date | null;
  nextRunAt: Date;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Score the business value of an insight based on breadth and novelty.
 * @param affectedCount - Number of entities affected by the insight
 * @param insightType - Type of insight (anomalies score higher)
 * @param severity - Severity level
 * @returns Value score 0-100
 */
export function scoreInsightValue(
  affectedCount: number,
  insightType: InsightType,
  severity: InsightSeverity,
): number {
  const breadthScore = Math.min(affectedCount / 10, 40);
  const typeScore: Record<InsightType, number> = {
    anomaly: 30, outlier: 25, trend: 20, missing_data: 20, relationship: 15, pattern: 10,
  };
  const severityScore: Record<InsightSeverity, number> = { critical: 30, warning: 20, info: 10 };
  return Math.round(breadthScore + (typeScore[insightType] ?? 10) + (severityScore[severity] ?? 10));
}

/**
 * Classify insight severity based on affectedCount and type.
 * @param affectedCount - Number of affected entities
 * @param insightType - Type of insight
 * @returns Severity classification
 */
export function classifyInsightSeverity(affectedCount: number, insightType: InsightType): InsightSeverity {
  if (insightType === 'anomaly' && affectedCount > 50) return 'critical';
  if (insightType === 'missing_data' && affectedCount > 20) return 'critical';
  if (affectedCount > 20 || insightType === 'anomaly') return 'warning';
  return 'info';
}

/**
 * Compute the next run date for a scheduled report.
 * @param granularity - Frequency ('daily' or 'weekly')
 * @param fromDate - Base date to compute from
 * @returns Next run timestamp
 */
export function computeNextRunAt(granularity: InsightGranularity, fromDate: Date): Date {
  const d = new Date(fromDate);
  if (granularity === 'daily') {
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 7);
    d.setHours(6, 0, 0, 0);
  }
  return d;
}

/**
 * Summarize an insight into a plain-English title.
 * @param insightType - Type of insight
 * @param entityType - Entity type affected
 * @param affectedCount - How many entities are affected
 * @returns Human-readable title string
 */
export function generateInsightTitle(insightType: InsightType, entityType: string, affectedCount: number): string {
  const titles: Record<InsightType, string> = {
    anomaly: `Anomaly detected in ${affectedCount} ${entityType} records`,
    trend: `Trending change observed across ${affectedCount} ${entityType} records`,
    outlier: `${affectedCount} ${entityType} records identified as outliers`,
    missing_data: `${affectedCount} ${entityType} records have missing required data`,
    relationship: `New relationship pattern found across ${affectedCount} ${entityType} records`,
    pattern: `Recurring pattern detected in ${affectedCount} ${entityType} records`,
  };
  return titles[insightType];
}

// ─── InsightGenerator ─────────────────────────────────────────────────────────

export class InsightGenerator {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Scan entities to detect patterns and generate insights.
   * @param entityTypes - Entity types to analyze
   * @param filters - Optional workspace or date range filters
   * @returns Generated insight records
   */
  async discoverInsights(
    entityTypes: string[],
    filters?: { workspaceId?: string; sinceDate?: Date },
  ): Promise<Result<GeneratedInsight[], Error>> {
    try {
      const insights: GeneratedInsight[] = [];
      for (const entityType of entityTypes) {
        type MissingRow = { missing_count: number };
        const [missing] = await this.sql<MissingRow[]>`
          SELECT COUNT(*)::int AS missing_count
          FROM iris_entities
          WHERE type = ${entityType}
            AND (${filters?.workspaceId ? this.sql`workspace_id = ${filters.workspaceId}` : this.sql`TRUE`})
            AND (attributes->>'email' IS NULL AND attributes->>'phone' IS NULL)
            AND (${filters?.sinceDate ? this.sql`created_at >= ${filters.sinceDate}` : this.sql`TRUE`})
        `;
        if ((missing?.missing_count ?? 0) > 0) {
          const count = missing!.missing_count;
          const severity = classifyInsightSeverity(count, 'missing_data');
          const id = randomUUID();
          insights.push({
            id,
            entityType,
            insightType: 'missing_data',
            title: generateInsightTitle('missing_data', entityType, count),
            summary: `${count} ${entityType} records lack both email and phone contact information.`,
            affectedCount: count,
            severity,
            valueScore: scoreInsightValue(count, 'missing_data', severity),
            evidence: [`${count} entities with no email or phone`],
            detectedAt: new Date(),
          });
        }
      }
      log.info('Insights discovered', { entityTypes, count: insights.length });
      return ok(insights);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate an executive insight report for an entity type.
   * @param entityType - Entity type to report on
   * @param granularity - Report granularity ('daily' | 'weekly')
   * @returns Structured insight report
   */
  async generateInsightReport(
    entityType: string,
    granularity: InsightGranularity = 'daily',
  ): Promise<Result<InsightReport, Error>> {
    try {
      type Row = {
        id: string; entity_type: string; insight_type: string; title: string; summary: string;
        affected_count: number; severity: string; value_score: number; evidence: unknown; detected_at: Date;
      };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_type, insight_type, title, summary, affected_count, severity, value_score, evidence, detected_at
        FROM generated_insights
        WHERE entity_type = ${entityType}
          AND detected_at >= NOW() - (${granularity === 'daily' ? '1 day' : '7 days'})::interval
        ORDER BY value_score DESC, detected_at DESC
        LIMIT 50
      `;
      const insights = rows.map((r) => ({
        id: r.id, entityType: r.entity_type,
        insightType: r.insight_type as InsightType, title: r.title, summary: r.summary,
        affectedCount: r.affected_count, severity: r.severity as InsightSeverity,
        valueScore: r.value_score,
        evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : JSON.parse(r.evidence as unknown as string),
        detectedAt: r.detected_at,
      }));
      return ok({
        entityType,
        granularity,
        generatedAt: new Date(),
        totalInsights: insights.length,
        criticalCount: insights.filter((i) => i.severity === 'critical').length,
        warningCount: insights.filter((i) => i.severity === 'warning').length,
        infoCount: insights.filter((i) => i.severity === 'info').length,
        highlights: insights.slice(0, 5),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get paginated insight list with optional type and severity filters.
   * @param options - Filter + pagination options
   * @returns Paginated insights
   */
  async listInsights(options: {
    insightType?: InsightType;
    severity?: InsightSeverity;
    entityType?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Result<{ insights: GeneratedInsight[]; nextCursor: string | null }, Error>> {
    const limit = Math.min(options.limit ?? 20, 100);
    try {
      type Row = {
        id: string; entity_type: string; insight_type: string; title: string; summary: string;
        affected_count: number; severity: string; value_score: number; evidence: unknown; detected_at: Date;
      };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_type, insight_type, title, summary, affected_count, severity, value_score, evidence, detected_at
        FROM generated_insights
        WHERE (${options.insightType ? this.sql`insight_type = ${options.insightType}` : this.sql`TRUE`})
          AND (${options.severity ? this.sql`severity = ${options.severity}` : this.sql`TRUE`})
          AND (${options.entityType ? this.sql`entity_type = ${options.entityType}` : this.sql`TRUE`})
          AND (${options.cursor ? this.sql`id > ${options.cursor}` : this.sql`TRUE`})
        ORDER BY value_score DESC, detected_at DESC, id
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const slice = rows.slice(0, limit);
      return ok({
        insights: slice.map((r) => ({
          id: r.id, entityType: r.entity_type,
          insightType: r.insight_type as InsightType, title: r.title, summary: r.summary,
          affectedCount: r.affected_count, severity: r.severity as InsightSeverity,
          valueScore: r.value_score,
          evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : JSON.parse(r.evidence as unknown as string),
          detectedAt: r.detected_at,
        })),
        nextCursor: hasMore ? (slice[slice.length - 1]?.id ?? null) : null,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Save a generated insight to the database.
   * @param insight - Insight to persist
   */
  async saveInsight(insight: Omit<GeneratedInsight, 'id' | 'detectedAt'>): Promise<Result<GeneratedInsight, Error>> {
    const id = randomUUID();
    const detectedAt = new Date();
    try {
      await this.sql`
        INSERT INTO generated_insights (id, entity_type, insight_type, title, summary, affected_count, severity, value_score, evidence, detected_at)
        VALUES (${id}, ${insight.entityType}, ${insight.insightType}, ${insight.title}, ${insight.summary},
                ${insight.affectedCount}, ${insight.severity}, ${insight.valueScore}, ${JSON.stringify(insight.evidence)}, ${detectedAt})
      `;
      return ok({ ...insight, id, detectedAt });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record value feedback for an insight.
   * @param insightId - Insight identifier
   * @param wasValuable - Whether the user found it valuable
   */
  async submitFeedback(insightId: string, wasValuable: boolean): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO insight_value_feedback (id, insight_id, was_valuable, occurred_at)
        VALUES (${randomUUID()}, ${insightId}, ${wasValuable}, NOW())
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Schedule an automated insight report.
   * @param entityTypes - Entity types to report on
   * @param frequency - Run frequency
   * @param recipients - Recipient identifiers
   * @returns Scheduled report record
   */
  async scheduleInsightGeneration(
    entityTypes: string[],
    frequency: InsightGranularity,
    recipients: string[],
  ): Promise<Result<ScheduledReport, Error>> {
    const id = randomUUID();
    const nextRunAt = computeNextRunAt(frequency, new Date());
    try {
      await this.sql`
        INSERT INTO insight_delivery_jobs (id, entity_types, frequency, recipients, next_run_at)
        VALUES (${id}, ${JSON.stringify(entityTypes)}, ${frequency}, ${JSON.stringify(recipients)}, ${nextRunAt})
      `;
      return ok({ id, entityTypes, frequency, recipients, lastRunAt: null, nextRunAt });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get all scheduled insight reports.
   */
  async listScheduledReports(): Promise<Result<ScheduledReport[], Error>> {
    try {
      type Row = { id: string; entity_types: unknown; frequency: string; recipients: unknown; last_run_at: Date | null; next_run_at: Date };
      const rows = await this.sql<Row[]>`
        SELECT id, entity_types, frequency, recipients, last_run_at, next_run_at
        FROM insight_delivery_jobs
        ORDER BY next_run_at ASC
      `;
      return ok(rows.map((r) => ({
        id: r.id,
        entityTypes: Array.isArray(r.entity_types) ? (r.entity_types as string[]) : JSON.parse(r.entity_types as unknown as string),
        frequency: r.frequency as InsightGranularity,
        recipients: Array.isArray(r.recipients) ? (r.recipients as string[]) : JSON.parse(r.recipients as unknown as string),
        lastRunAt: r.last_run_at,
        nextRunAt: r.next_run_at,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
