import { describe, it, expect, vi } from 'vitest';
import {
  computeCentroid,
  cosineSimilarity,
  kMeansCluster,
  extractClusterSignature,
  predictOptimalCacheTtl,
  clusterQueriesBySemanticSimilarity,
  adaptiveTtlAssignment,
  detectCacheInvalidationPatterns,
  persistClusters,
} from '../query-cluster-engine';

type Sql = Parameters<typeof clusterQueriesBySemanticSimilarity>[0];

describe('computeCentroid', () => {
  it('returns correct centroid for two vectors', () => {
    const c = computeCentroid([[1, 0], [0, 1]]);
    expect(c).toEqual([0.5, 0.5]);
  });

  it('returns empty array for empty input', () => {
    expect(computeCentroid([])).toEqual([]);
  });

  it('returns the vector itself for a single input', () => {
    expect(computeCentroid([[1, 2, 3]])).toEqual([1, 2, 3]);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('kMeansCluster', () => {
  it('assigns all points when k=1', () => {
    const embeddings = [
      { queryHash: 'q1', vector: [1, 0] },
      { queryHash: 'q2', vector: [0, 1] },
    ];
    const result = kMeansCluster(embeddings, 1);
    expect(result).toHaveLength(2);
    expect(new Set(result.map(r => r.clusterId)).size).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(kMeansCluster([], 5)).toHaveLength(0);
  });

  it('clamps k to number of points', () => {
    const embeddings = [
      { queryHash: 'q1', vector: [1, 0] },
      { queryHash: 'q2', vector: [0, 1] },
    ];
    const result = kMeansCluster(embeddings, 10);
    expect(result).toHaveLength(2);
  });

  it('each point has similarity score between -1 and 1', () => {
    const embeddings = Array.from({ length: 20 }, (_, i) => ({
      queryHash: `q${i}`,
      vector: [Math.cos(i * 0.3), Math.sin(i * 0.3)],
    }));
    const result = kMeansCluster(embeddings, 4);
    for (const r of result) {
      expect(r.similarity).toBeGreaterThanOrEqual(-1);
      expect(r.similarity).toBeLessThanOrEqual(1.001);
    }
  });

  it('produces consistent cluster assignments for clearly separated data', () => {
    const embeddings = [
      { queryHash: 'a1', vector: [1, 0] },
      { queryHash: 'a2', vector: [0.99, 0.01] },
      { queryHash: 'b1', vector: [-1, 0] },
      { queryHash: 'b2', vector: [-0.99, 0.01] },
    ];
    const result = kMeansCluster(embeddings, 2);
    const clusterA = result.find(r => r.queryHash === 'a1')!.clusterId;
    const clusterA2 = result.find(r => r.queryHash === 'a2')!.clusterId;
    const clusterB = result.find(r => r.queryHash === 'b1')!.clusterId;
    expect(clusterA).toBe(clusterA2);
    expect(clusterA).not.toBe(clusterB);
  });
});

describe('extractClusterSignature', () => {
  it('selects top 3 most common entity types', () => {
    const entityTypes = ['contact', 'contact', 'deal', 'company', 'contact', 'deal'];
    const sig = extractClusterSignature(entityTypes, [50], [1, 0]);
    expect(sig.dominantEntityTypes[0]).toBe('contact');
    expect(sig.dominantEntityTypes).toHaveLength(3);
  });

  it('detects analytical intent for metric-heavy clusters', () => {
    const sig = extractClusterSignature(['metric', 'metric', 'deal'], [30], [1, 0]);
    expect(sig.queryIntent).toBe('analytical');
  });

  it('returns operational intent for contact/task clusters', () => {
    const sig = extractClusterSignature(['contact', 'task', 'contact'], [40], [1, 0]);
    expect(sig.queryIntent).toBe('operational');
  });

  it('uses median for update frequency percentile', () => {
    const sig = extractClusterSignature(['contact'], [10, 50, 90], []);
    expect(sig.updateFrequencyPercentile).toBe(50);
  });
});

describe('predictOptimalCacheTtl', () => {
  it('assigns STABLE_REFERENCE TTL (86400s) for low-velocity clusters', () => {
    const { ttlSeconds, strategy } = predictOptimalCacheTtl(10, 'operational');
    expect(ttlSeconds).toBe(86400);
    expect(strategy).toBe('stable_reference');
  });

  it('assigns HIGH_VELOCITY TTL (300s) for high-velocity clusters', () => {
    const { ttlSeconds, strategy } = predictOptimalCacheTtl(80, 'operational');
    expect(ttlSeconds).toBe(300);
    expect(strategy).toBe('high_velocity');
  });

  it('assigns moderate TTL for mid-range velocity', () => {
    const { ttlSeconds } = predictOptimalCacheTtl(40, 'operational');
    expect(ttlSeconds).toBe(3600);
  });

  it('lowers effective velocity for analytical queries (more tolerance)', () => {
    const { ttlSeconds: analytical } = predictOptimalCacheTtl(25, 'analytical');
    const { ttlSeconds: operational } = predictOptimalCacheTtl(25, 'operational');
    expect(analytical).toBeGreaterThanOrEqual(operational);
  });
});

describe('clusterQueriesBySemanticSimilarity', () => {
  it('returns empty array when no query data', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await clusterQueriesBySemanticSimilarity(sql as unknown as Sql, 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toHaveLength(0);
  });

  it('returns clusters for valid query data', async () => {
    const vectors = Array.from({ length: 20 }, (_, i) => ({
      query_hash: `q${i}`,
      embedding_vector: [Math.cos(i * 0.5), Math.sin(i * 0.5)],
      entity_types_accessed: i % 2 === 0 ? ['contact'] : ['deal'],
      executed_at: new Date().toISOString(),
    }));
    const sql = vi.fn().mockResolvedValue(vectors);
    const result = await clusterQueriesBySemanticSimilarity(sql as unknown as Sql, 'ws1', 7);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]).toMatchObject({
        workspaceId: 'ws1',
        memberCount: expect.any(Number),
        optimalTtlSeconds: expect.any(Number),
      });
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await clusterQueriesBySemanticSimilarity(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('adaptiveTtlAssignment', () => {
  it('returns new_query strategy when no clusters exist', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await adaptiveTtlAssignment(sql as unknown as Sql, 'ws1', 'q1', [1, 0]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.strategy).toBe('new_query');
      expect(result.value.clusterId).toBeNull();
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await adaptiveTtlAssignment(sql as unknown as Sql, 'ws1', 'q1', [1, 0]);
    expect(result.isErr()).toBe(true);
  });
});

describe('detectCacheInvalidationPatterns', () => {
  it('returns invalidation event with affected clusters', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ cluster_id: 'c1' }, { cluster_id: 'c2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // INSERT
    const result = await detectCacheInvalidationPatterns(sql as unknown as Sql, 'ws1', 'contact');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.triggerEntityType).toBe('contact');
      expect(result.value.affectedClusters.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await detectCacheInvalidationPatterns(sql as unknown as Sql, 'ws1', 'deal');
    expect(result.isErr()).toBe(true);
  });
});

describe('persistClusters', () => {
  it('upserts clusters and memberships without error', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const clusters = [{
      clusterId: 'c1',
      workspaceId: 'ws1',
      clusterSignature: '{}',
      memberCount: 5,
      dominantEntityTypes: ['contact'],
      updateFrequencyPercentile: 30,
      optimalTtlSeconds: 86400,
      confidenceScore: 0.9,
      createdAt: new Date(),
    }];
    const memberships = [{ queryHash: 'q1', clusterId: 'c1', similarityScore: 0.85 }];
    const result = await persistClusters(sql as unknown as Sql, clusters, memberships);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await persistClusters(sql as unknown as Sql, [
      { clusterId: 'c1', workspaceId: 'ws1', clusterSignature: '{}', memberCount: 1, dominantEntityTypes: [], updateFrequencyPercentile: 50, optimalTtlSeconds: 900, confidenceScore: 0.7, createdAt: new Date() },
    ], []);
    expect(result.isErr()).toBe(true);
  });
});
