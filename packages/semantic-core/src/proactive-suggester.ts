import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'proactive-suggester' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecentActivity {
  query: string;
  entityType?: string;
  timestamp: Date;
}

export interface SuggestedContext {
  entityType: string;
  label: string;
  reason: string;
  confidence: number;
  entityId?: string;
}

export interface SuggestionResult {
  suggestions: SuggestedContext[];
  generatedAt: Date;
}

interface SuggestionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  entity_type: string;
  entity_label: string;
  entity_id: string | null;
  reason: string;
  confidence: number;
  suggested_at: Date;
}

interface CoOccurrenceRow {
  entity_type_a: string;
  entity_type_b: string;
  co_occurrence_count: number;
}

// ─── Suggestion Engine ────────────────────────────────────────────────────────

const TIME_OF_DAY_PATTERNS: Record<string, string[]> = {
  morning: ['task', 'meeting', 'schedule', 'standup'],
  afternoon: ['deal', 'opportunity', 'contact', 'proposal'],
  evening: ['report', 'metric', 'revenue', 'summary'],
};

function getTimeOfDay(date: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function extractEntityTypes(queries: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const ENTITY_KEYWORDS: Record<string, string[]> = {
    contact: ['contact', 'customer', 'person', 'lead', 'prospect', 'client'],
    deal: ['deal', 'opportunity', 'pipeline', 'sale', 'revenue'],
    company: ['company', 'account', 'organization', 'org', 'business'],
    issue: ['issue', 'ticket', 'bug', 'task', 'sprint', 'jira'],
    metric: ['metric', 'kpi', 'performance', 'report', 'dashboard'],
    document: ['document', 'doc', 'page', 'wiki', 'confluence', 'notion'],
    message: ['message', 'channel', 'slack', 'thread', 'conversation'],
  };

  for (const query of queries) {
    const lower = query.toLowerCase();
    for (const [type, keywords] of Object.entries(ENTITY_KEYWORDS)) {
      if (keywords.some(k => lower.includes(k))) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Generate proactive context suggestions based on recent query activity.
 * Uses: entity co-occurrence patterns, time-of-day patterns, query frequency.
 *
 * @param recentActivity - Last N queries from the user/workspace
 * @param userRole       - Optional role to weight suggestions toward (e.g., 'sales', 'engineering')
 * @param maxSuggestions - Maximum suggestions to return (default 3)
 */
export function generateSuggestions(
  recentActivity: RecentActivity[],
  userRole?: string,
  maxSuggestions = 3,
): SuggestionResult {
  const suggestions: SuggestedContext[] = [];
  const now = new Date();
  const timeOfDay = getTimeOfDay(now);

  const queries = recentActivity.map(a => a.query);
  const typeCounts = extractEntityTypes(queries);

  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [type, count] of topTypes) {
    const confidence = Math.min(0.95, 0.5 + (count / Math.max(queries.length, 1)) * 0.45);
    suggestions.push({
      entityType: type,
      label: `Recent ${type}s`,
      reason: `Frequently queried (${count} recent queries)`,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  const timePatterns = TIME_OF_DAY_PATTERNS[timeOfDay] ?? [];
  for (const keyword of timePatterns) {
    if (suggestions.some(s => s.entityType === keyword || s.label.toLowerCase().includes(keyword))) {
      continue;
    }
    suggestions.push({
      entityType: keyword,
      label: `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)}s`,
      reason: `Commonly accessed ${timeOfDay}`,
      confidence: 0.55,
    });
  }

  if (userRole) {
    const ROLE_AFFINITIES: Record<string, string[]> = {
      sales: ['deal', 'contact', 'company'],
      engineering: ['issue', 'document', 'message'],
      finance: ['metric', 'deal', 'company'],
      ops: ['metric', 'task', 'document'],
    };
    const affinities = ROLE_AFFINITIES[userRole.toLowerCase()] ?? [];
    for (const type of affinities) {
      if (!suggestions.some(s => s.entityType === type)) {
        suggestions.push({
          entityType: type,
          label: `${type.charAt(0).toUpperCase()}${type.slice(1)}s`,
          reason: `Typical for ${userRole} role`,
          confidence: 0.6,
        });
      }
    }
  }

  const top = suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxSuggestions);

  log.debug('Suggestions generated', { count: top.length, timeOfDay });

  return { suggestions: top, generatedAt: now };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

type SqlClient = ReturnType<typeof postgres>;

/**
 * Persists and retrieves proactive context suggestions.
 */
export class ProactiveSuggesterService {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Log a suggestion set for a workspace/user so it can be analysed later.
   *
   * @param workspaceId  - Workspace the suggestion was generated for
   * @param userId       - User the suggestion was targeted at (may be 'system' for global)
   * @param suggestions  - The suggestions to persist
   */
  async logSuggestions(
    workspaceId: string,
    userId: string,
    suggestions: SuggestedContext[],
  ): Promise<Result<void, Error>> {
    if (suggestions.length === 0) return ok(undefined);
    try {
      for (const s of suggestions) {
        await this.sql`
          INSERT INTO context_suggestions
            (workspace_id, user_id, entity_type, entity_label, entity_id, reason, confidence)
          VALUES
            (${workspaceId}, ${userId}, ${s.entityType}, ${s.label},
             ${s.entityId ?? null}, ${s.reason}, ${s.confidence})
        `;
      }
      return ok(undefined);
    } catch (e) {
      log.error('Failed to log suggestions', { workspaceId, userId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieve the most recent suggestions for a workspace/user.
   *
   * @param workspaceId - Workspace to query
   * @param userId      - User to filter by
   * @param limit       - Max rows to return (default 10)
   */
  async getRecentSuggestions(
    workspaceId: string,
    userId: string,
    limit = 10,
  ): Promise<Result<SuggestedContext[], Error>> {
    try {
      const rows = await this.sql<SuggestionRow[]>`
        SELECT id, workspace_id, user_id, entity_type, entity_label, entity_id, reason, confidence, suggested_at
        FROM context_suggestions
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        ORDER BY suggested_at DESC
        LIMIT ${limit}
      `;
      const suggestions: SuggestedContext[] = rows.map(r => ({
        entityType: r.entity_type,
        label: r.entity_label,
        reason: r.reason,
        confidence: r.confidence,
        ...(r.entity_id !== null ? { entityId: r.entity_id } : {}),
      }));
      return ok(suggestions);
    } catch (e) {
      log.error('Failed to get recent suggestions', { workspaceId, userId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Fetch entity type co-occurrence patterns from the audit log.
   * Used to improve suggestions by finding entity types commonly queried together.
   *
   * @param workspaceId - Workspace to analyse
   * @param limit       - Max co-occurrence pairs to return
   */
  async getCoOccurrencePatterns(
    workspaceId: string,
    limit = 20,
  ): Promise<Result<CoOccurrenceRow[], Error>> {
    try {
      const rows = await this.sql<CoOccurrenceRow[]>`
        SELECT
          a.entity_type AS entity_type_a,
          b.entity_type AS entity_type_b,
          COUNT(*) AS co_occurrence_count
        FROM context_suggestions a
        JOIN context_suggestions b
          ON a.workspace_id = b.workspace_id
          AND a.user_id = b.user_id
          AND a.entity_type < b.entity_type
          AND ABS(EXTRACT(EPOCH FROM (a.suggested_at - b.suggested_at))) < 300
        WHERE a.workspace_id = ${workspaceId}
        GROUP BY a.entity_type, b.entity_type
        ORDER BY co_occurrence_count DESC
        LIMIT ${limit}
      `;
      return ok(rows);
    } catch (e) {
      log.error('Failed to get co-occurrence patterns', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
