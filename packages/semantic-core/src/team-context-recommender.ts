import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'team-context-recommender' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TeamContextUsage = {
  teamId: string;
  entityId: string;
  entityType: string;
  accessCount: number;
  lastAccessedAt: Date;
  roleId: string;
};

export type RoleContextAffinity = {
  roleId: string;
  entityType: string;
  affinityScore: number;
  updatedAt: Date;
};

export type TeamRecommendation = {
  teamId: string;
  entityId: string;
  entityType: string;
  score: number;
  reasons: string[];
};

export type ContextExpansionSuggestion = {
  entityId: string;
  entityType: string;
  suggestion: string;
  potentialValue: number;
};

export type TeamUsageWindow = '7d' | '30d' | '90d';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute a recommendation score for an entity given access signal components.
 * @param roleWeightedAccess - Normalized role-weighted access frequency (0-1)
 * @param recency - Recency score derived from last-access days ago (0-1)
 * @param relationshipProximity - Proximity to other accessed entities (0-1)
 * @param teamPopularity - How popular the entity is within the team (0-1)
 * @returns Weighted recommendation score 0-100
 */
export function computeRecommendationScore(
  roleWeightedAccess: number,
  recency: number,
  relationshipProximity: number,
  teamPopularity: number,
): number {
  return Math.round(
    roleWeightedAccess * 40 +
    recency * 30 +
    relationshipProximity * 20 +
    teamPopularity * 10,
  );
}

/**
 * Decay recency score based on days since last access.
 * Score drops by half every 7 days.
 * @param daysSinceLastAccess - Days since entity was last accessed
 * @returns Recency score 0-1
 */
export function computeRecencyScore(daysSinceLastAccess: number): number {
  if (daysSinceLastAccess <= 0) return 1;
  return Math.exp(-0.099 * daysSinceLastAccess);
}

/**
 * Normalize access count to a 0-1 score using log normalization.
 * @param accessCount - Raw access count
 * @param maxAccessCount - Maximum access count in the dataset
 * @returns Normalized score 0-1
 */
export function normalizeAccessCount(accessCount: number, maxAccessCount: number): number {
  if (maxAccessCount <= 0) return 0;
  return Math.log1p(accessCount) / Math.log1p(maxAccessCount);
}

/**
 * Generate human-readable reasons for a recommendation.
 * @param roleWeightedAccess - Normalized access by role (0-1)
 * @param recency - Recency score (0-1)
 * @param teamPopularity - Team popularity score (0-1)
 * @returns Array of reason strings
 */
export function generateRecommendationReasons(
  roleWeightedAccess: number,
  recency: number,
  teamPopularity: number,
): string[] {
  const reasons: string[] = [];
  if (roleWeightedAccess > 0.6) reasons.push('Frequently accessed by your role');
  else if (roleWeightedAccess > 0.3) reasons.push('Accessed by similar roles');
  if (recency > 0.8) reasons.push('Recently active');
  if (teamPopularity > 0.7) reasons.push('Popular across the team');
  else if (teamPopularity > 0.4) reasons.push('Accessed by team members');
  if (reasons.length === 0) reasons.push('Relevant to your team context');
  return reasons;
}

// ─── TeamContextRecommender ───────────────────────────────────────────────────

export class TeamContextRecommender {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Analyze aggregate context usage patterns for a team within a time window.
   * @param teamId - Team identifier
   * @param window - Analysis window (7d, 30d, 90d)
   * @returns Usage summary by entity type
   */
  async analyzeTeamContextUsage(
    teamId: string,
    window: TeamUsageWindow = '30d',
  ): Promise<Result<{ entityType: string; totalAccesses: number; uniqueEntities: number }[], Error>> {
    const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
    try {
      type Row = { entity_type: string; total_accesses: number; unique_entities: number };
      const rows = await this.sql<Row[]>`
        SELECT entity_type,
               SUM(access_count)::int AS total_accesses,
               COUNT(DISTINCT entity_id)::int AS unique_entities
        FROM team_context_usage
        WHERE team_id = ${teamId}
          AND last_accessed_at >= NOW() - (${days} || ' days')::interval
        GROUP BY entity_type
        ORDER BY total_accesses DESC
      `;
      return ok(rows.map((r) => ({
        entityType: r.entity_type,
        totalAccesses: r.total_accesses,
        uniqueEntities: r.unique_entities,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Generate ranked entity recommendations for a team.
   * @param teamId - Team identifier
   * @param topK - Number of recommendations to return
   * @returns Ranked recommendations with scores and reasons
   */
  async generateTeamRecommendations(
    teamId: string,
    topK = 15,
  ): Promise<Result<TeamRecommendation[], Error>> {
    try {
      type Row = {
        entity_id: string; entity_type: string; role_id: string;
        access_count: number; last_accessed_at: Date; max_access: number;
        team_total: number; team_max: number;
      };
      const rows = await this.sql<Row[]>`
        WITH team_usage AS (
          SELECT entity_id, entity_type, role_id, access_count, last_accessed_at,
                 MAX(access_count) OVER () AS max_access
          FROM team_context_usage
          WHERE team_id = ${teamId}
        ),
        team_popularity AS (
          SELECT entity_id,
                 SUM(access_count)::int AS team_total,
                 MAX(SUM(access_count)) OVER ()::int AS team_max
          FROM team_context_usage
          WHERE team_id = ${teamId}
          GROUP BY entity_id
        )
        SELECT tu.entity_id, tu.entity_type, tu.role_id, tu.access_count,
               tu.last_accessed_at, tu.max_access,
               tp.team_total, tp.team_max
        FROM team_usage tu
        JOIN team_popularity tp ON tu.entity_id = tp.entity_id
        LIMIT 200
      `;

      const scored = rows.map((r) => {
        const daysSince = (Date.now() - new Date(r.last_accessed_at).getTime()) / 86400000;
        const roleWeighted = normalizeAccessCount(r.access_count, r.max_access);
        const recency = computeRecencyScore(daysSince);
        const teamPop = normalizeAccessCount(r.team_total, r.team_max);
        const score = computeRecommendationScore(roleWeighted, recency, 0.5, teamPop);
        const reasons = generateRecommendationReasons(roleWeighted, recency, teamPop);
        return { teamId, entityId: r.entity_id, entityType: r.entity_type, score, reasons };
      });

      scored.sort((a, b) => b.score - a.score);
      const deduped: TeamRecommendation[] = [];
      const seen = new Set<string>();
      for (const r of scored) {
        if (!seen.has(r.entityId)) { seen.add(r.entityId); deduped.push(r); }
        if (deduped.length >= topK) break;
      }
      log.info('Recommendations generated', { teamId, count: deduped.length });
      return ok(deduped);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Predict context needs for a role based on historical queries.
   * @param roleId - Role identifier
   * @returns Predicted entity types and specific entities likely needed
   */
  async predictContextNeedsByRole(
    roleId: string,
  ): Promise<Result<{ entityType: string; entityId: string; affinityScore: number }[], Error>> {
    try {
      type Row = { entity_id: string; entity_type: string; affinity_score: number };
      const rows = await this.sql<Row[]>`
        SELECT tcu.entity_id, tcu.entity_type,
               COALESCE(rca.affinity_score, 0.5) AS affinity_score
        FROM team_context_usage tcu
        LEFT JOIN role_context_affinities rca
          ON rca.role_id = ${roleId} AND rca.entity_type = tcu.entity_type
        WHERE tcu.role_id = ${roleId}
        ORDER BY affinity_score DESC, tcu.access_count DESC
        LIMIT 30
      `;
      return ok(rows.map((r) => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        affinityScore: r.affinity_score,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest underutilized but potentially valuable entity contexts for a team.
   * @param teamId - Team identifier
   * @returns Expansion suggestions with potential value scores
   */
  async suggestContextExpansionForTeam(
    teamId: string,
  ): Promise<Result<ContextExpansionSuggestion[], Error>> {
    try {
      type Row = { entity_id: string; entity_type: string; global_access: number; team_access: number };
      const rows = await this.sql<Row[]>`
        WITH global_popular AS (
          SELECT entity_id, entity_type, SUM(access_count)::int AS global_access
          FROM team_context_usage
          GROUP BY entity_id, entity_type
          ORDER BY global_access DESC
          LIMIT 50
        ),
        team_accessed AS (
          SELECT entity_id, SUM(access_count)::int AS team_access
          FROM team_context_usage
          WHERE team_id = ${teamId}
          GROUP BY entity_id
        )
        SELECT gp.entity_id, gp.entity_type, gp.global_access,
               COALESCE(ta.team_access, 0) AS team_access
        FROM global_popular gp
        LEFT JOIN team_accessed ta ON gp.entity_id = ta.entity_id
        WHERE COALESCE(ta.team_access, 0) < gp.global_access * 0.2
        ORDER BY gp.global_access DESC
        LIMIT 10
      `;
      return ok(rows.map((r) => {
        const potentialValue = Math.round(
          (r.global_access - r.team_access) / Math.max(r.global_access, 1) * 100,
        );
        return {
          entityId: r.entity_id,
          entityType: r.entity_type,
          suggestion: `This ${r.entity_type} is popular across other teams but underused by yours`,
          potentialValue,
        };
      }));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record a context access event for a team/role.
   * @param teamId - Team identifier
   * @param roleId - Role identifier
   * @param entityId - Accessed entity
   * @param entityType - Entity type
   */
  async recordContextAccess(
    teamId: string,
    roleId: string,
    entityId: string,
    entityType: string,
  ): Promise<Result<void, Error>> {
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO team_context_usage (id, team_id, role_id, entity_id, entity_type, access_count, last_accessed_at)
        VALUES (${id}, ${teamId}, ${roleId}, ${entityId}, ${entityType}, 1, NOW())
        ON CONFLICT (team_id, role_id, entity_id)
        DO UPDATE SET access_count = team_context_usage.access_count + 1, last_accessed_at = NOW()
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Save team context preferences (pinned/dismissed entities).
   * @param teamId - Team identifier
   * @param preferences - Map of entityId → 'pin' | 'dismiss'
   */
  async saveContextPreferences(
    teamId: string,
    preferences: Record<string, 'pin' | 'dismiss'>,
  ): Promise<Result<void, Error>> {
    try {
      for (const [entityId, action] of Object.entries(preferences)) {
        await this.sql`
          INSERT INTO team_recommendations (id, team_id, entity_id, preference, updated_at)
          VALUES (${randomUUID()}, ${teamId}, ${entityId}, ${action}, NOW())
          ON CONFLICT (team_id, entity_id) DO UPDATE SET preference = EXCLUDED.preference, updated_at = NOW()
        `;
      }
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
