import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'proactive-context' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuggestionFeedback = 'accepted' | 'ignored' | 'modified';

export interface AgentBehaviorProfile {
  workspaceId: string;
  agentId: string;
  frequentEntityTypes: string[];
  queryPatterns: Record<string, number>;
  totalQueries: number;
  learnedAt: string;
}

export interface ProactiveSuggestion {
  id: string;
  workspaceId: string;
  agentId: string;
  entityTypes: string[];
  contextHints: string[];
  score: number;
  createdAt: string;
}

export interface ProactiveSettings {
  workspaceId: string;
  agentId: string;
  aggressiveness: 'low' | 'medium' | 'high';
  enabledEntityTypes: string[];
  updatedAt: string;
}

export interface FeedbackInput {
  workspaceId: string;
  agentId: string;
  suggestionId: string;
  feedback: SuggestionFeedback;
  feedbackScore?: number;
}

export interface AcceptanceStats {
  total: number;
  accepted: number;
  ignored: number;
  modified: number;
  acceptanceRate: number;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface BehaviorRow {
  workspace_id: string;
  agent_id: string;
  entity_types: string[];
  query_patterns_json: Record<string, number>;
  total_queries: string;
  learned_at: string;
}

interface SuggestionRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  entity_types: string[];
  context_hints: string[];
  score: string;
  created_at: string;
}

interface SettingsRow {
  workspace_id: string;
  agent_id: string;
  aggressiveness: 'low' | 'medium' | 'high';
  enabled_entity_types: string[];
  updated_at: string;
}

type SqlClient = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — required for jsonb columns (plain strings are stored as jsonb string scalars) */
  json(value: unknown): unknown;
};

function rowToProfile(r: BehaviorRow): AgentBehaviorProfile {
  return {
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    frequentEntityTypes: r.entity_types,
    queryPatterns: r.query_patterns_json,
    totalQueries: parseInt(r.total_queries, 10),
    learnedAt: r.learned_at,
  };
}

function rowToSuggestion(r: SuggestionRow): ProactiveSuggestion {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    entityTypes: r.entity_types,
    contextHints: r.context_hints,
    score: parseFloat(r.score),
    createdAt: r.created_at,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Learns agent query behavior and generates proactive context suggestions
 * to push relevant entities before agents explicitly request them.
 */
export class ProactiveContextEngine {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Record an agent query event to build behavioral profiles.
   * Upserts the profile and increments query count for the entity types seen.
   *
   * @param workspaceId  - Target workspace
   * @param agentId      - Agent identifier
   * @param entityTypes  - Entity types accessed in this query
   * @param queryPattern - A normalized label for this query pattern
   */
  async recordQueryEvent(
    workspaceId: string,
    agentId: string,
    entityTypes: string[],
    queryPattern: string,
  ): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO agent_behavior_profiles
          (workspace_id, agent_id, entity_types, query_patterns_json, total_queries, learned_at)
        VALUES (
          ${workspaceId}, ${agentId},
          ${entityTypes},
          ${this.sql.json({ [queryPattern]: 1 })},
          1,
          NOW()
        )
        ON CONFLICT (workspace_id, agent_id) DO UPDATE SET
          entity_types        = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(
                agent_behavior_profiles.entity_types || EXCLUDED.entity_types
              )
            )
          ),
          query_patterns_json = agent_behavior_profiles.query_patterns_json ||
            jsonb_build_object(
              ${queryPattern}::text,
              COALESCE((agent_behavior_profiles.query_patterns_json ->> ${queryPattern}::text)::int, 0) + 1
            ),
          total_queries = agent_behavior_profiles.total_queries + 1,
          learned_at    = NOW()
      `;
      log.debug('Agent query event recorded', { workspaceId, agentId, entityTypes, queryPattern });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the behavioral profile for an agent, or null if not yet learned.
   *
   * @param workspaceId - Target workspace
   * @param agentId     - Agent identifier
   */
  async getAgentProfile(
    workspaceId: string,
    agentId: string,
  ): Promise<Result<AgentBehaviorProfile | null, Error>> {
    try {
      const rows = await this.sql`
        SELECT * FROM agent_behavior_profiles
        WHERE workspace_id = ${workspaceId} AND agent_id = ${agentId}
        LIMIT 1
      ` as BehaviorRow[];
      return ok(rows[0] ? rowToProfile(rows[0]) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate proactive context suggestions for an agent based on its history.
   * Returns the top N entity types and context hints sorted by predicted utility.
   *
   * @param workspaceId - Target workspace
   * @param agentId     - Agent identifier
   * @param currentContext - What the agent is currently asking about
   * @param maxSuggestions - Max number of suggestions to generate (default: 5)
   */
  async predictContext(
    workspaceId: string,
    agentId: string,
    currentContext: string,
    maxSuggestions = 5,
  ): Promise<Result<ProactiveSuggestion[], Error>> {
    try {
      const profileResult = await this.getAgentProfile(workspaceId, agentId);
      if (profileResult.isErr()) return err(profileResult.error);

      const profile = profileResult.value;
      if (!profile || profile.totalQueries < 3) {
        return ok([]);
      }

      const topEntityTypes = profile.frequentEntityTypes.slice(0, maxSuggestions);
      const contextHints = topEntityTypes.map(
        (type) => `Proactively load recent ${type} entities related to: ${currentContext}`,
      );

      const score = Math.min(1, profile.totalQueries / 100);

      const rows = await this.sql`
        INSERT INTO proactive_suggestions
          (workspace_id, agent_id, entity_types, context_hints, score)
        VALUES (
          ${workspaceId}, ${agentId},
          ${topEntityTypes},
          ${contextHints},
          ${score}
        )
        RETURNING *
      ` as SuggestionRow[];

      const suggestion = rows[0];
      if (!suggestion) return ok([]);

      log.info('Proactive context generated', { workspaceId, agentId, entityCount: topEntityTypes.length, score });
      return ok([rowToSuggestion(suggestion)]);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record agent feedback for a proactive suggestion (accepted/ignored/modified).
   *
   * @param input - Feedback details
   */
  async recordFeedback(input: FeedbackInput): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE proactive_suggestions
        SET feedback        = ${input.feedback},
            feedback_score  = ${input.feedbackScore ?? null},
            accepted        = ${input.feedback === 'accepted'},
            feedback_at     = NOW()
        WHERE id = ${input.suggestionId}
          AND workspace_id = ${input.workspaceId}
          AND agent_id = ${input.agentId}
      `;
      log.info('Proactive suggestion feedback recorded', {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        feedback: input.feedback,
      });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Upsert proactive settings for an agent (aggressiveness, enabled entity types).
   *
   * @param workspaceId      - Target workspace
   * @param agentId          - Agent identifier
   * @param aggressiveness   - How aggressively to push context
   * @param enabledEntityTypes - Entity types to include in proactive suggestions
   */
  async saveSettings(
    workspaceId: string,
    agentId: string,
    aggressiveness: ProactiveSettings['aggressiveness'],
    enabledEntityTypes: string[],
  ): Promise<Result<ProactiveSettings, Error>> {
    try {
      const [row] = await this.sql`
        INSERT INTO agent_proactive_settings
          (workspace_id, agent_id, aggressiveness, enabled_entity_types, updated_at)
        VALUES (
          ${workspaceId}, ${agentId}, ${aggressiveness}, ${enabledEntityTypes}, NOW()
        )
        ON CONFLICT (workspace_id, agent_id) DO UPDATE SET
          aggressiveness       = EXCLUDED.aggressiveness,
          enabled_entity_types = EXCLUDED.enabled_entity_types,
          updated_at           = NOW()
        RETURNING *
      ` as SettingsRow[];
      if (!row) return err(new Error('Settings upsert returned no row'));
      return ok({
        workspaceId: row.workspace_id,
        agentId: row.agent_id,
        aggressiveness: row.aggressiveness,
        enabledEntityTypes: row.enabled_entity_types,
        updatedAt: row.updated_at,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Compute acceptance statistics for proactive suggestions for an agent.
   *
   * @param workspaceId - Target workspace
   * @param agentId     - Agent identifier
   */
  async getAcceptanceStats(
    workspaceId: string,
    agentId: string,
  ): Promise<Result<AcceptanceStats, Error>> {
    try {
      const [row] = await this.sql`
        SELECT
          COUNT(*)                                               AS total,
          COUNT(*) FILTER (WHERE feedback = 'accepted')        AS accepted,
          COUNT(*) FILTER (WHERE feedback = 'ignored')         AS ignored,
          COUNT(*) FILTER (WHERE feedback = 'modified')        AS modified
        FROM proactive_suggestions
        WHERE workspace_id = ${workspaceId} AND agent_id = ${agentId}
          AND feedback IS NOT NULL
      ` as Array<{ total: string; accepted: string; ignored: string; modified: string }>;

      const r = row ?? { total: '0', accepted: '0', ignored: '0', modified: '0' };
      const total = parseInt(r.total, 10);
      const accepted = parseInt(r.accepted, 10);

      return ok({
        total,
        accepted,
        ignored: parseInt(r.ignored, 10),
        modified: parseInt(r.modified, 10),
        acceptanceRate: total > 0 ? accepted / total : 0,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
