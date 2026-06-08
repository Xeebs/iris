import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'context-summarizer' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type QueryIntent = 'analytical' | 'operational' | 'reporting' | 'synthesis';
export type LLMProvider = 'anthropic' | 'openai' | 'azure' | 'gemini';
export type SummaryFormat = 'bullet_list' | 'json' | 'prose' | 'table';

export type ContextEntity = {
  id: string;
  type: string;
  label: string;
  attributes: Record<string, unknown>;
  relationships?: Array<{ type: string; targetId: string }>;
};

export type RankedEntity = ContextEntity & {
  relevanceScore: number;
  relevanceReason: string;
};

export type TaskSpecificSummary = {
  content: string;
  format: SummaryFormat;
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
  intent: QueryIntent;
  provider: LLMProvider;
};

export type SummarizationMetrics = {
  workspaceId: string;
  totalSummaries: number;
  avgCompressionRatio: number;
  avgSatisfactionScore: number;
  byIntent: Record<QueryIntent, { count: number; avgCompression: number }>;
};

/** Keyword patterns used to classify query intent. */
const INTENT_PATTERNS: Record<QueryIntent, RegExp> = {
  analytical: /analyz|why|trend|forecast|predict|compare|insight|pattern|anomal|correlat/i,
  operational: /show|list|get|find|search|filter|who|what|where|which|current|active/i,
  reporting: /report|summary|overview|export|count|total|metric|kpi|dashboard|aggregate/i,
  synthesis: /combine|merge|consolidat|synthesize|relate|link|connect|across|from.*and/i,
};

/** Per-provider preferred output format. */
const PROVIDER_FORMATS: Record<LLMProvider, SummaryFormat> = {
  anthropic: 'bullet_list',
  openai: 'json',
  azure: 'json',
  gemini: 'prose',
};

/** Intent → entity type relevance weights (higher = more relevant for this intent). */
const INTENT_ENTITY_WEIGHTS: Record<QueryIntent, Record<string, number>> = {
  analytical: { deal: 1.0, metric: 1.0, contact: 0.7, company: 0.8, activity: 0.6 },
  operational: { contact: 1.0, task: 1.0, company: 0.9, deal: 0.7, activity: 0.8 },
  reporting: { metric: 1.0, deal: 0.9, company: 0.8, contact: 0.6, activity: 0.5 },
  synthesis: { contact: 0.8, company: 1.0, deal: 0.9, metric: 0.7, activity: 0.7 },
};

/**
 * Classify the intent of a query.
 * @param query - Natural language query
 * @returns Detected intent type
 */
export function classifyQueryIntent(query: string): QueryIntent {
  const scores: Record<QueryIntent, number> = { analytical: 0, operational: 0, reporting: 0, synthesis: 0 };

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS) as [QueryIntent, RegExp][]) {
    const matches = query.match(pattern);
    scores[intent] = matches ? matches.length : 0;
  }

  // Default to operational if no signal
  const best = (Object.entries(scores) as [QueryIntent, number][]).reduce(
    (a, b) => (b[1] > a[1] ? b : a),
    ['operational' as QueryIntent, 0],
  );
  return best[1] > 0 ? best[0] : 'operational';
}

/**
 * Score and rank context entities by relevance to a given task intent.
 * @param entities - List of entities to rank
 * @param intent - Classified query intent
 * @returns Ranked entities with scores
 */
export function rankContextByTaskRelevance(
  entities: ContextEntity[],
  intent: QueryIntent,
): RankedEntity[] {
  const weights = INTENT_ENTITY_WEIGHTS[intent];

  return entities
    .map(entity => {
      const typeKey = entity.type.toLowerCase().replace(/_.*/, '');
      const typeWeight = weights[typeKey] ?? 0.5;

      // Bonus for entities with relationships (more connected = more relevant)
      const relationshipBonus = Math.min(0.2, (entity.relationships?.length ?? 0) * 0.05);

      // Bonus for entities with many attributes (richer data = more useful)
      const attrCount = Object.keys(entity.attributes).length;
      const attrBonus = Math.min(0.1, attrCount * 0.01);

      const relevanceScore = Math.min(1, typeWeight + relationshipBonus + attrBonus);

      const relevanceReason = `Entity type weight: ${typeWeight.toFixed(2)}`
        + (relationshipBonus > 0 ? `, relationships: +${relationshipBonus.toFixed(2)}` : '')
        + (attrBonus > 0 ? `, attributes: +${attrBonus.toFixed(2)}` : '');

      return { ...entity, relevanceScore, relevanceReason };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatAsBulletList(entities: RankedEntity[], targetTokens: number): string {
  const lines: string[] = [];
  let tokens = 0;

  for (const entity of entities) {
    const attrStr = Object.entries(entity.attributes)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    const line = `• ${entity.type.toUpperCase()} — ${entity.label}${attrStr ? ` (${attrStr})` : ''}`;
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > targetTokens) break;
    lines.push(line);
    tokens += lineTokens;
  }

  return lines.join('\n');
}

function formatAsJSON(entities: RankedEntity[], targetTokens: number): string {
  const result: Array<{ id: string; type: string; label: string; attributes: Record<string, unknown> }> = [];
  let tokens = 2; // [] braces

  for (const entity of entities) {
    const item = {
      id: entity.id,
      type: entity.type,
      label: entity.label,
      attributes: Object.fromEntries(Object.entries(entity.attributes).slice(0, 5)),
    };
    const itemStr = JSON.stringify(item);
    const itemTokens = estimateTokens(itemStr) + 2; // commas
    if (tokens + itemTokens > targetTokens) break;
    result.push(item);
    tokens += itemTokens;
  }

  return JSON.stringify(result);
}

function formatAsProse(entities: RankedEntity[], targetTokens: number): string {
  const parts: string[] = [];
  let tokens = 0;

  for (const entity of entities) {
    const attrStr = Object.entries(entity.attributes)
      .slice(0, 3)
      .map(([k, v]) => `${k} is ${v}`)
      .join(', ');
    const sentence = `${entity.label} is a ${entity.type}${attrStr ? ` where ${attrStr}` : ''}.`;
    const sentenceTokens = estimateTokens(sentence);
    if (tokens + sentenceTokens > targetTokens) break;
    parts.push(sentence);
    tokens += sentenceTokens;
  }

  return parts.join(' ');
}

/**
 * Generate a task-specific summary optimized for the given LLM provider.
 * @param entities - Ranked entities to summarize
 * @param intent - Query intent
 * @param provider - Target LLM provider
 * @param targetTokens - Token budget for summary
 */
export function generateTaskSpecificSummary(
  entities: RankedEntity[],
  intent: QueryIntent,
  provider: LLMProvider,
  targetTokens: number,
): TaskSpecificSummary {
  const format = PROVIDER_FORMATS[provider];
  const originalStr = JSON.stringify(entities);
  const originalTokens = estimateTokens(originalStr);

  let content: string;
  switch (format) {
    case 'bullet_list':
      content = formatAsBulletList(entities, targetTokens);
      break;
    case 'json':
      content = formatAsJSON(entities, targetTokens);
      break;
    case 'prose':
      content = formatAsProse(entities, targetTokens);
      break;
    default:
      content = formatAsBulletList(entities, targetTokens);
  }

  const summaryTokens = estimateTokens(content);
  const compressionRatio = originalTokens > 0 ? Math.round((1 - summaryTokens / originalTokens) * 100) / 100 : 0;

  return { content, format, originalTokens, summaryTokens, compressionRatio, intent, provider };
}

/**
 * Optimize summary structure for token efficiency based on provider format rules.
 * @param summary - Raw summary content
 * @param format - Target format
 * @returns Optimized summary string
 */
export function optimizeSummaryStructure(summary: string, format: SummaryFormat): string {
  switch (format) {
    case 'json':
      try {
        const parsed: unknown = JSON.parse(summary);
        return JSON.stringify(parsed);
      } catch {
        return summary;
      }
    case 'bullet_list':
      return summary.split('\n').filter(Boolean).join('\n');
    case 'prose':
      return summary.replace(/\s+/g, ' ').trim();
    default:
      return summary;
  }
}

/**
 * Record summarization metrics for analytics.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 * @param originalTokenCount - Token count before summarization
 * @param summaryTokenCount - Token count after summarization
 * @param queryIntent - Classified intent
 * @param satisfactionScore - Optional user satisfaction (0-1)
 */
export async function recordSummarizationMetrics(
  sql: SqlFn,
  workspaceId: string,
  originalTokenCount: number,
  summaryTokenCount: number,
  queryIntent: QueryIntent,
  satisfactionScore?: number,
): Promise<Result<void, Error>> {
  try {
    const compressionRatio = originalTokenCount > 0
      ? Math.round((1 - summaryTokenCount / originalTokenCount) * 10000) / 10000
      : 0;

    await sql`
      INSERT INTO summary_metrics
        (workspace_id, original_token_count, summary_token_count, compression_ratio,
         user_satisfaction_score, query_intent, generated_at)
      VALUES (
        ${workspaceId}, ${originalTokenCount}, ${summaryTokenCount}, ${compressionRatio},
        ${satisfactionScore ?? null}, ${queryIntent}, NOW()
      )
    `;
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Get summarization metrics aggregated by workspace and intent.
 * @param sql - SQL function
 * @param workspaceId - Workspace context
 */
export async function getSummarizationMetrics(
  sql: SqlFn,
  workspaceId: string,
): Promise<Result<SummarizationMetrics, Error>> {
  try {
    const rows = await sql`
      SELECT query_intent,
             COUNT(*) AS total_count,
             AVG(compression_ratio) AS avg_compression,
             AVG(user_satisfaction_score) AS avg_satisfaction
      FROM summary_metrics
      WHERE workspace_id = ${workspaceId}
      GROUP BY query_intent
    ` as unknown as Array<{
      query_intent: QueryIntent;
      total_count: string;
      avg_compression: string | null;
      avg_satisfaction: string | null;
    }>;

    const byIntent: SummarizationMetrics['byIntent'] = {
      analytical: { count: 0, avgCompression: 0 },
      operational: { count: 0, avgCompression: 0 },
      reporting: { count: 0, avgCompression: 0 },
      synthesis: { count: 0, avgCompression: 0 },
    };

    let totalSummaries = 0;
    let totalCompressionSum = 0;
    let totalSatisfactionSum = 0;
    let satisfactionCount = 0;

    for (const row of rows) {
      const count = parseInt(row.total_count, 10);
      const avgComp = parseFloat(row.avg_compression ?? '0');
      totalSummaries += count;
      totalCompressionSum += avgComp * count;
      if (row.avg_satisfaction) {
        totalSatisfactionSum += parseFloat(row.avg_satisfaction) * count;
        satisfactionCount += count;
      }
      if (row.query_intent in byIntent) {
        byIntent[row.query_intent] = { count, avgCompression: Math.round(avgComp * 100) / 100 };
      }
    }

    const avgCompressionRatio = totalSummaries > 0 ? totalCompressionSum / totalSummaries : 0;
    const avgSatisfactionScore = satisfactionCount > 0 ? totalSatisfactionSum / satisfactionCount : 0;

    log.info('Summarization metrics loaded', { workspaceId, totalSummaries });

    return ok({
      workspaceId,
      totalSummaries,
      avgCompressionRatio: Math.round(avgCompressionRatio * 10000) / 10000,
      avgSatisfactionScore: Math.round(avgSatisfactionScore * 100) / 100,
      byIntent,
    });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
