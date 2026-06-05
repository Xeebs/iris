import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';

import { PrefixCacheManager, buildPrefixContent } from '../prefix-cache.js';

function makeMockRedis(): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

const WORKSPACE = 'ws-test';

// ─── buildPrefixContent() ─────────────────────────────────────────────────────

describe('buildPrefixContent()', () => {
  it('includes workspace header', () => {
    const content = buildPrefixContent(WORKSPACE, {});
    expect(content).toContain(`## Workspace: ${WORKSPACE}`);
  });

  it('omits sections when context is empty', () => {
    const content = buildPrefixContent(WORKSPACE, {});
    expect(content).not.toContain('### Glossary');
    expect(content).not.toContain('### Metrics');
    expect(content).not.toContain('### Entity Types');
  });

  it('renders glossary section with sorted keys', () => {
    const content = buildPrefixContent(WORKSPACE, {
      glossary: { churn: 'Monthly customer loss rate', arr: 'Annual Recurring Revenue' },
    });
    expect(content).toContain('### Glossary');
    expect(content).toContain('arr: Annual Recurring Revenue');
    expect(content).toContain('churn: Monthly customer loss rate');
    // arr should come before churn (alphabetical)
    expect(content.indexOf('arr')).toBeLessThan(content.indexOf('churn'));
  });

  it('renders metrics section with unit when provided', () => {
    const content = buildPrefixContent(WORKSPACE, {
      metrics: { mrr: { description: 'Monthly Recurring Revenue', unit: 'USD' } },
    });
    expect(content).toContain('### Metrics');
    expect(content).toContain('mrr: Monthly Recurring Revenue (USD)');
  });

  it('renders metrics section without unit when absent', () => {
    const content = buildPrefixContent(WORKSPACE, {
      metrics: { score: { description: 'Lead score' } },
    });
    expect(content).toContain('score: Lead score');
    expect(content).not.toContain('(undefined)');
  });

  it('renders entity types section with sorted keys', () => {
    const content = buildPrefixContent(WORKSPACE, {
      schemaSummaries: { deal: 'name, amount, stage', contact: 'name, email, company' },
    });
    expect(content).toContain('### Entity Types');
    // contact before deal (alphabetical)
    expect(content.indexOf('contact')).toBeLessThan(content.indexOf('deal'));
  });

  it('produces deterministic output for identical inputs', () => {
    const ctx = {
      glossary: { b: 'def-b', a: 'def-a' },
      metrics: { y: { description: 'desc-y' }, x: { description: 'desc-x' } },
    };
    const c1 = buildPrefixContent(WORKSPACE, ctx);
    const c2 = buildPrefixContent(WORKSPACE, ctx);
    expect(c1).toBe(c2);
  });
});

// ─── PrefixCacheManager ───────────────────────────────────────────────────────

describe('PrefixCacheManager', () => {
  let redis: Redis;
  let manager: PrefixCacheManager;

  beforeEach(() => {
    redis = makeMockRedis();
    manager = new PrefixCacheManager(redis, 3600);
  });

  describe('get()', () => {
    it('returns null when no block is cached', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const block = await manager.get(WORKSPACE);
      expect(block).toBeNull();
    });

    it('returns null when cached value is malformed JSON', async () => {
      vi.mocked(redis.get).mockResolvedValue('not-json{{{');
      const block = await manager.get(WORKSPACE);
      expect(block).toBeNull();
    });

    it('returns parsed PrefixBlock when cached', async () => {
      const stored = {
        workspaceId: WORKSPACE,
        content: '## Workspace: ws-test',
        tokenEstimate: 5,
        builtAt: new Date().toISOString(),
      };
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(stored));
      const block = await manager.get(WORKSPACE);
      expect(block).not.toBeNull();
      expect(block?.workspaceId).toBe(WORKSPACE);
      expect(block?.tokenEstimate).toBe(5);
    });
  });

  describe('set()', () => {
    it('stores the block in Redis with EX TTL', async () => {
      const block = await manager.set(WORKSPACE, { glossary: { arr: 'Annual Recurring Revenue' } });
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining(WORKSPACE),
        expect.any(String),
        'EX',
        3600,
      );
      expect(block.workspaceId).toBe(WORKSPACE);
      expect(block.content).toContain('arr');
      expect(block.tokenEstimate).toBeGreaterThan(0);
    });

    it('computes tokenEstimate as ceil(content.length / 4)', async () => {
      const block = await manager.set(WORKSPACE, {});
      expect(block.tokenEstimate).toBe(Math.ceil(block.content.length / 4));
    });
  });

  describe('invalidate()', () => {
    it('deletes the Redis key', async () => {
      await manager.invalidate(WORKSPACE);
      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(WORKSPACE));
    });
  });
});
