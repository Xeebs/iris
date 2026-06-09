import { describe, it, expect, vi } from 'vitest';
import {
  computeRecommendationScore,
  computeRecencyScore,
  normalizeAccessCount,
  generateRecommendationReasons,
  TeamContextRecommender,
} from '../team-context-recommender.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeRecommendationScore ───────────────────────────────────────────────

describe('computeRecommendationScore', () => {
  it('returns 100 for all max signals', () => {
    expect(computeRecommendationScore(1, 1, 1, 1)).toBe(100);
  });

  it('returns 0 for all zero signals', () => {
    expect(computeRecommendationScore(0, 0, 0, 0)).toBe(0);
  });

  it('weights role access at 40%', () => {
    expect(computeRecommendationScore(1, 0, 0, 0)).toBe(40);
  });

  it('weights recency at 30%', () => {
    expect(computeRecommendationScore(0, 1, 0, 0)).toBe(30);
  });

  it('weights relationship at 20%', () => {
    expect(computeRecommendationScore(0, 0, 1, 0)).toBe(20);
  });

  it('weights team popularity at 10%', () => {
    expect(computeRecommendationScore(0, 0, 0, 1)).toBe(10);
  });

  it('produces intermediate score for mixed signals', () => {
    const score = computeRecommendationScore(0.5, 0.5, 0.5, 0.5);
    expect(score).toBe(50);
  });
});

// ─── computeRecencyScore ──────────────────────────────────────────────────────

describe('computeRecencyScore', () => {
  it('returns 1 for 0 days ago', () => {
    expect(computeRecencyScore(0)).toBeCloseTo(1, 2);
  });

  it('returns less than 1 for any positive days', () => {
    expect(computeRecencyScore(1)).toBeLessThan(1);
  });

  it('decreases monotonically', () => {
    const s1 = computeRecencyScore(7);
    const s2 = computeRecencyScore(14);
    expect(s1).toBeGreaterThan(s2);
  });

  it('drops to roughly 0.5 around 7 days', () => {
    expect(computeRecencyScore(7)).toBeCloseTo(0.5, 1);
  });

  it('approaches 0 for very old accesses', () => {
    expect(computeRecencyScore(100)).toBeLessThan(0.05);
  });
});

// ─── normalizeAccessCount ─────────────────────────────────────────────────────

describe('normalizeAccessCount', () => {
  it('returns 0 when maxAccessCount is 0', () => {
    expect(normalizeAccessCount(5, 0)).toBe(0);
  });

  it('returns 1 when accessCount equals max', () => {
    expect(normalizeAccessCount(100, 100)).toBe(1);
  });

  it('returns 0 for zero accessCount', () => {
    expect(normalizeAccessCount(0, 100)).toBe(0);
  });

  it('returns value between 0 and 1 for partial count', () => {
    const v = normalizeAccessCount(10, 100);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('is log-normalized (diminishing returns)', () => {
    const half = normalizeAccessCount(50, 100);
    const full = normalizeAccessCount(100, 100);
    expect(full - half).toBeLessThan(half);
  });
});

// ─── generateRecommendationReasons ───────────────────────────────────────────

describe('generateRecommendationReasons', () => {
  it('produces at least one reason', () => {
    const reasons = generateRecommendationReasons(0, 0, 0);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('mentions role when role access is high', () => {
    const reasons = generateRecommendationReasons(0.8, 0, 0);
    expect(reasons.some((r) => r.toLowerCase().includes('role'))).toBe(true);
  });

  it('mentions recency when recent', () => {
    const reasons = generateRecommendationReasons(0, 0.9, 0);
    expect(reasons.some((r) => r.toLowerCase().includes('recent'))).toBe(true);
  });

  it('mentions team popularity when high', () => {
    const reasons = generateRecommendationReasons(0, 0, 0.8);
    expect(reasons.some((r) => r.toLowerCase().includes('team'))).toBe(true);
  });
});

// ─── TeamContextRecommender ───────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('TeamContextRecommender.analyzeTeamContextUsage', () => {
  it('returns empty array when no usage data', async () => {
    const mgr = new TeamContextRecommender(makeSql([]));
    const result = await mgr.analyzeTeamContextUsage('team-1', '7d');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('returns mapped usage rows', async () => {
    const rows = [{ entity_type: 'contact', total_accesses: 42, unique_entities: 10 }];
    const mgr = new TeamContextRecommender(makeSql(rows));
    const result = await mgr.analyzeTeamContextUsage('team-1', '30d');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]!.totalAccesses).toBe(42);
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new TeamContextRecommender(sql);
    const result = await mgr.analyzeTeamContextUsage('team-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('TeamContextRecommender.generateTeamRecommendations', () => {
  it('returns empty when no data', async () => {
    const mgr = new TeamContextRecommender(makeSql([]));
    const result = await mgr.generateTeamRecommendations('team-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('scores and deduplicates entities', async () => {
    const now = new Date();
    const row = {
      entity_id: 'e1', entity_type: 'contact', role_id: 'r1',
      access_count: 10, last_accessed_at: now, max_access: 10, team_total: 10, team_max: 10,
    };
    const mgr = new TeamContextRecommender(makeSql([row, row]));
    const result = await mgr.generateTeamRecommendations('team-1', 5);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().length).toBe(1);
  });

  it('includes reasons in recommendations', async () => {
    const now = new Date();
    const row = {
      entity_id: 'e1', entity_type: 'contact', role_id: 'r1',
      access_count: 10, last_accessed_at: now, max_access: 10, team_total: 10, team_max: 10,
    };
    const mgr = new TeamContextRecommender(makeSql([row]));
    const result = await mgr.generateTeamRecommendations('team-1');
    expect(result._unsafeUnwrap()[0]!.reasons.length).toBeGreaterThan(0);
  });
});

describe('TeamContextRecommender.predictContextNeedsByRole', () => {
  it('returns predicted entities for role', async () => {
    const rows = [{ entity_id: 'e1', entity_type: 'deal', affinity_score: 0.9 }];
    const mgr = new TeamContextRecommender(makeSql(rows));
    const result = await mgr.predictContextNeedsByRole('role-admin');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]!.affinityScore).toBe(0.9);
  });
});

describe('TeamContextRecommender.suggestContextExpansionForTeam', () => {
  it('returns expansion suggestions', async () => {
    const rows = [{ entity_id: 'e2', entity_type: 'company', global_access: 100, team_access: 5 }];
    const mgr = new TeamContextRecommender(makeSql(rows));
    const result = await mgr.suggestContextExpansionForTeam('team-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()[0]!.potentialValue).toBeGreaterThan(0);
  });
});

describe('TeamContextRecommender.recordContextAccess', () => {
  it('returns ok on success', async () => {
    const mgr = new TeamContextRecommender(makeSql([]));
    const result = await mgr.recordContextAccess('team-1', 'role-1', 'e1', 'contact');
    expect(result.isOk()).toBe(true);
  });
});

describe('TeamContextRecommender.saveContextPreferences', () => {
  it('returns ok for valid preferences', async () => {
    const mgr = new TeamContextRecommender(makeSql([]));
    const result = await mgr.saveContextPreferences('team-1', { 'e1': 'pin', 'e2': 'dismiss' });
    expect(result.isOk()).toBe(true);
  });
});
