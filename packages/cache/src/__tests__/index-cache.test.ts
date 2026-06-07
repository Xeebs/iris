import { describe, it, expect } from 'vitest';
import { IndexCache } from '../index-cache.js';

describe('IndexCache', () => {
  it('returns null on cold miss', () => {
    const cache = new IndexCache();
    expect(cache.get('missing-key')).toBeNull();
  });

  it('returns entry after set', () => {
    const cache = new IndexCache();
    const vec = Array.from({ length: 16 }, (_, i) => i * 0.1);
    cache.set('key-1', { queryVector: vec, entityIds: ['e1', 'e2'], scores: [0.9, 0.8] });
    const entry = cache.get('key-1');
    expect(entry).not.toBeNull();
    expect(entry?.entityIds).toEqual(['e1', 'e2']);
  });

  it('evicts LRU entry when at capacity', () => {
    const cache = new IndexCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.set('k1', { queryVector: [], entityIds: ['e1'], scores: [1] });
    cache.set('k2', { queryVector: [], entityIds: ['e2'], scores: [1] });
    cache.set('k3', { queryVector: [], entityIds: ['e3'], scores: [1] });
    cache.set('k4', { queryVector: [], entityIds: ['e4'], scores: [1] });
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k4')).not.toBeNull();
  });

  it('size reflects active entries', () => {
    const cache = new IndexCache({ maxEntries: 10, ttlMs: 60_000 });
    cache.set('k1', { queryVector: [], entityIds: [], scores: [] });
    cache.set('k2', { queryVector: [], entityIds: [], scores: [] });
    expect(cache.size).toBe(2);
  });

  it('invalidates entries by workspace prefix', () => {
    const cache = new IndexCache();
    cache.set('ws-A:key1', { queryVector: [], entityIds: [], scores: [] });
    cache.set('ws-A:key2', { queryVector: [], entityIds: [], scores: [] });
    cache.set('ws-B:key1', { queryVector: [], entityIds: [], scores: [] });
    const removed = cache.invalidateWorkspace('ws-A');
    expect(removed).toBe(2);
    expect(cache.get('ws-B:key1')).not.toBeNull();
  });

  it('returns null for expired entries', async () => {
    const cache = new IndexCache({ maxEntries: 100, ttlMs: 1 });
    cache.set('exp', { queryVector: [], entityIds: [], scores: [] });
    await new Promise(r => setTimeout(r, 5));
    expect(cache.get('exp')).toBeNull();
  });

  it('clear empties all entries', () => {
    const cache = new IndexCache();
    cache.set('k1', { queryVector: [], entityIds: [], scores: [] });
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('buildKey is deterministic', () => {
    const vec = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const k1 = IndexCache.buildKey('ws-1', vec, ['contact'], 10);
    const k2 = IndexCache.buildKey('ws-1', vec, ['contact'], 10);
    expect(k1).toBe(k2);
  });

  it('buildKey differs for different entity types', () => {
    const vec = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const k1 = IndexCache.buildKey('ws-1', vec, ['contact'], 10);
    const k2 = IndexCache.buildKey('ws-1', vec, ['deal'], 10);
    expect(k1).not.toBe(k2);
  });

  it('buildKey differs for different workspaces', () => {
    const vec = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const k1 = IndexCache.buildKey('ws-1', vec, ['contact'], 10);
    const k2 = IndexCache.buildKey('ws-2', vec, ['contact'], 10);
    expect(k1).not.toBe(k2);
  });
});
