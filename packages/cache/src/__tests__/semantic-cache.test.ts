import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticCache, DEFAULT_CACHE_CONFIG } from '../semantic-cache.js';
import type { Redis } from 'ioredis';

function makeVector(seed: number, dims = 8): number[] {
  return Array.from({ length: dims }, (_, i) => (i === seed ? 1 : 0));
}

function makeMockPipeline() {
  const pipeline = {
    hset: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    sadd: vi.fn().mockReturnThis(),
    hdel: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return pipeline;
}

function makeMockRedis(): Redis {
  const pipeline = makeMockPipeline();
  return {
    hvals: vi.fn().mockResolvedValue([]),
    smembers: vi.fn().mockResolvedValue([]),
    pipeline: vi.fn().mockReturnValue(pipeline),
  } as unknown as Redis;
}

const WORKSPACE = 'ws-test';

describe('SemanticCache', () => {
  let redis: Redis;
  let cache: SemanticCache;

  beforeEach(() => {
    redis = makeMockRedis();
    cache = new SemanticCache(redis, { hitThreshold: 0.92, ttlSeconds: 60 });
  });

  describe('get()', () => {
    it('returns null when no entries exist', async () => {
      vi.mocked(redis.hvals).mockResolvedValue([]);
      const result = await cache.get(makeVector(0), WORKSPACE);
      expect(result).toBeNull();
    });

    it('returns null when best similarity is below threshold', async () => {
      const entry = {
        id: 'e1',
        queryEmbedding: makeVector(0),
        response: 'response',
        tokenCount: 10,
        workspaceId: WORKSPACE,
        entityIds: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      };
      vi.mocked(redis.hvals).mockResolvedValue([JSON.stringify(entry)]);

      // makeVector(1) is orthogonal to makeVector(0) → similarity = 0 < 0.92
      const result = await cache.get(makeVector(1), WORKSPACE);
      expect(result).toBeNull();
    });

    it('returns entry when similarity exceeds threshold', async () => {
      const vec = makeVector(0);
      const entry = {
        id: 'e1',
        queryEmbedding: vec,
        response: 'cached response',
        tokenCount: 50,
        workspaceId: WORKSPACE,
        entityIds: ['entity-1'],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      };
      vi.mocked(redis.hvals).mockResolvedValue([JSON.stringify(entry)]);

      const result = await cache.get(vec, WORKSPACE);
      expect(result).not.toBeNull();
      expect(result?.response).toBe('cached response');
      expect(result?.id).toBe('e1');
    });

    it('skips expired entries', async () => {
      const entry = {
        id: 'e1',
        queryEmbedding: makeVector(0),
        response: 'stale',
        tokenCount: 10,
        workspaceId: WORKSPACE,
        entityIds: [],
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000), // already expired
      };
      vi.mocked(redis.hvals).mockResolvedValue([JSON.stringify(entry)]);

      const result = await cache.get(makeVector(0), WORKSPACE);
      expect(result).toBeNull();
    });

    it('returns the best match when multiple entries exist', async () => {
      const vec = makeVector(0);
      const nearIdentical = makeVector(0); // similarity ≈ 1.0
      const entryA = {
        id: 'a',
        queryEmbedding: nearIdentical,
        response: 'response A',
        tokenCount: 10,
        workspaceId: WORKSPACE,
        entityIds: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      };
      vi.mocked(redis.hvals).mockResolvedValue([JSON.stringify(entryA)]);

      const result = await cache.get(vec, WORKSPACE);
      expect(result?.response).toBe('response A');
    });
  });

  describe('set()', () => {
    it('stores entry in Redis hash with pipeline', async () => {
      const pipeline = makeMockPipeline();
      vi.mocked(redis.pipeline).mockReturnValue(pipeline as unknown as ReturnType<Redis['pipeline']>);

      await cache.set(makeVector(0), 'response', 42, WORKSPACE, ['entity-1', 'entity-2']);

      expect(pipeline.hset).toHaveBeenCalledOnce();
      expect(pipeline.expire).toHaveBeenCalled();
      expect(pipeline.sadd).toHaveBeenCalledTimes(2); // one per entityId
      expect(pipeline.exec).toHaveBeenCalledOnce();
    });

    it('creates entity index entries for each entity ID', async () => {
      const pipeline = makeMockPipeline();
      vi.mocked(redis.pipeline).mockReturnValue(pipeline as unknown as ReturnType<Redis['pipeline']>);

      await cache.set(makeVector(0), 'resp', 10, WORKSPACE, ['e1', 'e2', 'e3']);

      const saddCalls = pipeline.sadd.mock.calls;
      expect(saddCalls).toHaveLength(3);
    });
  });

  describe('invalidate()', () => {
    it('returns 0 when no entity IDs provided', async () => {
      const count = await cache.invalidate([], WORKSPACE);
      expect(count).toBe(0);
    });

    it('deletes cache entries associated with entity IDs', async () => {
      vi.mocked(redis.smembers)
        .mockResolvedValueOnce(['entry-1', 'entry-2'])
        .mockResolvedValueOnce(['entry-2', 'entry-3']);

      const pipeline = makeMockPipeline();
      vi.mocked(redis.pipeline).mockReturnValue(pipeline as unknown as ReturnType<Redis['pipeline']>);

      const count = await cache.invalidate(['entity-1', 'entity-2'], WORKSPACE);

      expect(count).toBe(3); // entry-1, entry-2, entry-3 (deduplicated)
      expect(pipeline.hdel).toHaveBeenCalledTimes(3);
      expect(pipeline.exec).toHaveBeenCalledOnce();
    });

    it('returns count of unique entries deleted', async () => {
      vi.mocked(redis.smembers).mockResolvedValue(['entry-1']);
      const pipeline = makeMockPipeline();
      vi.mocked(redis.pipeline).mockReturnValue(pipeline as unknown as ReturnType<Redis['pipeline']>);

      const count = await cache.invalidate(['e1'], WORKSPACE);
      expect(count).toBe(1);
    });
  });

  describe('DEFAULT_CACHE_CONFIG', () => {
    it('has correct default hit threshold', () => {
      expect(DEFAULT_CACHE_CONFIG.hitThreshold).toBe(0.92);
    });

    it('has correct default TTL', () => {
      expect(DEFAULT_CACHE_CONFIG.ttlSeconds).toBe(3600);
    });
  });
});
