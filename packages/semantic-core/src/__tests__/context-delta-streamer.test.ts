import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashContextSnapshot,
  computeContextDelta,
  streamDeltaAsChunks,
  encodeContextDelta,
  captureContextSnapshot,
  getClientContextState,
  resetClientState,
  writeDeltaAudit,
  getDeltaHistory,
  type ContextEntity,
} from '../context-delta-streamer';

const entity = (id: string, label: string, attrs: Record<string, unknown> = {}): ContextEntity => ({
  id,
  type: 'contact',
  label,
  attributes: attrs,
  lastModified: '2026-06-08T00:00:00Z',
});

describe('hashContextSnapshot', () => {
  it('produces consistent hash for the same entities', () => {
    const entities = [entity('a', 'Alice'), entity('b', 'Bob')];
    expect(hashContextSnapshot(entities)).toBe(hashContextSnapshot(entities));
  });

  it('is order-independent (sorts by id)', () => {
    const e1 = [entity('a', 'Alice'), entity('b', 'Bob')];
    const e2 = [entity('b', 'Bob'), entity('a', 'Alice')];
    expect(hashContextSnapshot(e1)).toBe(hashContextSnapshot(e2));
  });

  it('differs when lastModified changes', () => {
    const entities = [{ ...entity('a', 'Alice'), lastModified: '2026-01-01' }];
    const updated = [{ ...entity('a', 'Alice'), lastModified: '2026-06-01' }];
    expect(hashContextSnapshot(entities)).not.toBe(hashContextSnapshot(updated));
  });

  it('returns a 64-char hex string', () => {
    expect(hashContextSnapshot([entity('x', 'X')])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeContextDelta', () => {
  const alice = entity('a', 'Alice', { stage: 'lead' });
  const bob = entity('b', 'Bob', { stage: 'customer' });

  it('identifies added entities when client has no prior context', () => {
    const delta = computeContextDelta(new Set(), new Map(), [alice, bob]);
    expect(delta.added).toHaveLength(2);
    expect(delta.removed).toHaveLength(0);
    expect(delta.modified).toHaveLength(0);
  });

  it('identifies removed entities', () => {
    const prevIds = new Set(['a', 'b']);
    const prevMap = new Map([['a', alice], ['b', bob]]);
    const delta = computeContextDelta(prevIds, prevMap, [alice]);
    expect(delta.removed).toHaveLength(1);
    expect(delta.removed[0]!.id).toBe('b');
  });

  it('identifies modified entities with field-level changes', () => {
    const prevIds = new Set(['a']);
    const prevMap = new Map([['a', alice]]);
    const updated = entity('a', 'Alice', { stage: 'customer' });
    const delta = computeContextDelta(prevIds, prevMap, [updated]);
    expect(delta.modified).toHaveLength(1);
    expect(delta.modified[0]!.changes[0]!.field).toBe('attributes.stage');
    expect(delta.modified[0]!.changes[0]!.oldValue).toBe('lead');
    expect(delta.modified[0]!.changes[0]!.newValue).toBe('customer');
  });

  it('identifies label change as a modification', () => {
    const prevIds = new Set(['a']);
    const prevMap = new Map([['a', alice]]);
    const renamed = entity('a', 'Alice Smith', { stage: 'lead' });
    const delta = computeContextDelta(prevIds, prevMap, [renamed]);
    expect(delta.modified[0]!.changes.some(c => c.field === 'label')).toBe(true);
  });

  it('returns zero savedTokens when everything is new', () => {
    const delta = computeContextDelta(new Set(), new Map(), [alice]);
    expect(delta.savedTokens).toBe(0);
  });

  it('computes token savings for unchanged entities', () => {
    const prevIds = new Set(['a', 'b', 'c']);
    const c = entity('c', 'Carol');
    const prevMap = new Map([['a', alice], ['b', bob], ['c', c]]);
    // Only 'a' changes — 'b' and 'c' are unchanged (not in delta)
    const updatedAlice = entity('a', 'Alice Updated', { stage: 'lead' });
    const delta = computeContextDelta(prevIds, prevMap, [updatedAlice, bob, c]);
    // 2 unchanged entities * 50 tokens = 100 saved tokens
    expect(delta.savedTokens).toBeGreaterThan(0);
  });

  it('reports no changes when context is identical', () => {
    const prevIds = new Set(['a', 'b']);
    const prevMap = new Map([['a', alice], ['b', bob]]);
    const delta = computeContextDelta(prevIds, prevMap, [alice, bob]);
    expect(delta.added).toHaveLength(0);
    expect(delta.removed).toHaveLength(0);
    expect(delta.modified).toHaveLength(0);
  });
});

describe('streamDeltaAsChunks', () => {
  it('returns empty array for delta with no added or modified entities', () => {
    const delta = computeContextDelta(new Set(['a']), new Map([['a', entity('a', 'Alice')]]), []);
    const chunks = streamDeltaAsChunks(delta);
    expect(chunks).toHaveLength(0);
  });

  it('produces correct chunk count for multiple entities', () => {
    const entities = Array.from({ length: 15 }, (_, i) => entity(`e${i}`, `Entity ${i}`));
    const delta = computeContextDelta(new Set(), new Map(), entities);
    // 15 entities, 500 token budget / 50 tokens per entity = 10 per chunk → 2 chunks
    const chunks = streamDeltaAsChunks(delta, 500);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.entities).toHaveLength(10);
    expect(chunks[1]!.entities).toHaveLength(5);
  });

  it('sets correct chunkIndex and totalChunks', () => {
    const entities = Array.from({ length: 25 }, (_, i) => entity(`e${i}`, `Entity ${i}`));
    const delta = computeContextDelta(new Set(), new Map(), entities);
    const chunks = streamDeltaAsChunks(delta, 500);
    for (const chunk of chunks) {
      expect(chunk.totalChunks).toBe(chunks.length);
    }
    expect(chunks[0]!.chunkIndex).toBe(0);
  });

  it('respects small chunkSizeTokens (1 entity per chunk)', () => {
    const entities = [entity('a', 'Alice'), entity('b', 'Bob')];
    const delta = computeContextDelta(new Set(), new Map(), entities);
    const chunks = streamDeltaAsChunks(delta, 30); // 30 < 50 = 1 entity/chunk
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.estimatedTokens).toBe(50);
  });
});

describe('encodeContextDelta', () => {
  it('includes deltaMode flag', () => {
    const delta = computeContextDelta(new Set(), new Map(), [entity('a', 'Alice')]);
    const encoded = encodeContextDelta(delta);
    expect(encoded.deltaMode).toBe(true);
  });

  it('encodes removed entities as references only', () => {
    const alice = entity('a', 'Alice', { email: 'a@example.com' });
    const prevIds = new Set(['a']);
    const prevMap = new Map([['a', alice]]);
    const delta = computeContextDelta(prevIds, prevMap, []);
    const encoded = encodeContextDelta(delta);
    const removed = encoded.removed as Array<{ id: string; type: string }>;
    expect(removed[0]).toEqual({ id: 'a', type: 'contact' });
    expect(removed[0]).not.toHaveProperty('attributes');
  });

  it('includes meta with savings info', () => {
    const delta = computeContextDelta(new Set(), new Map(), [entity('a', 'Alice')]);
    const encoded = encodeContextDelta(delta);
    const meta = encoded.meta as Record<string, unknown>;
    expect(meta).toHaveProperty('savedTokens');
    expect(meta).toHaveProperty('addedCount');
  });
});

describe('captureContextSnapshot', () => {
  it('calls sql with correct INSERT and returns ok', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const result = await captureContextSnapshot(
      mockSql as unknown as Parameters<typeof captureContextSnapshot>[0],
      'client-1',
      'ws-1',
      'hash-1',
      [entity('a', 'Alice')],
    );
    expect(result.isOk()).toBe(true);
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('returns err on sql failure', async () => {
    const mockSql = vi.fn().mockRejectedValue(new Error('DB error'));
    const result = await captureContextSnapshot(
      mockSql as unknown as Parameters<typeof captureContextSnapshot>[0],
      'client-1',
      'ws-1',
      'hash-1',
      [],
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('DB error');
  });
});

describe('getClientContextState', () => {
  it('returns null when no rows found', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const result = await getClientContextState(
      mockSql as unknown as Parameters<typeof getClientContextState>[0],
      'c1', 'ws1',
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns mapped state when row exists', async () => {
    const row = {
      client_id: 'c1', workspace_id: 'ws1',
      last_query_hash: 'hash', last_context_snapshot: 'snap',
      entities_served: ['e1', 'e2'],
      snapshot_created_at: '2026-06-08T00:00:00Z',
      expires_at: '2026-06-08T01:00:00Z',
    };
    const mockSql = vi.fn().mockResolvedValue([row]);
    const result = await getClientContextState(
      mockSql as unknown as Parameters<typeof getClientContextState>[0],
      'c1', 'ws1',
    );
    expect(result.isOk()).toBe(true);
    const state = result._unsafeUnwrap()!;
    expect(state.clientId).toBe('c1');
    expect(state.entitiesServed).toEqual(['e1', 'e2']);
    expect(state.expiresAt).toBeInstanceOf(Date);
  });
});

describe('resetClientState', () => {
  it('calls DELETE sql and returns ok', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const result = await resetClientState(
      mockSql as unknown as Parameters<typeof resetClientState>[0],
      'c1', 'ws1',
    );
    expect(result.isOk()).toBe(true);
  });
});

describe('writeDeltaAudit', () => {
  it('inserts audit row and returns ok', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const result = await writeDeltaAudit(
      mockSql as unknown as Parameters<typeof writeDeltaAudit>[0],
      { clientId: 'c1', deltaId: 'd1', entitiesAddedCount: 2, entitiesRemovedCount: 0, entitiesModifiedCount: 1, savedTokens: 100, streamChunks: 1 },
    );
    expect(result.isOk()).toBe(true);
  });
});

describe('getDeltaHistory', () => {
  it('returns empty entries when no rows', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    const result = await getDeltaHistory(
      mockSql as unknown as Parameters<typeof getDeltaHistory>[0],
      'c1', 'ws1', 20,
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().entries).toHaveLength(0);
    expect(result._unsafeUnwrap().nextCursor).toBeNull();
  });

  it('returns nextCursor when hasMore', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      client_id: 'c1', delta_id: `d${i}`,
      entities_added_count: 1, entities_removed_count: 0, entities_modified_count: 0,
      saved_tokens: 50, stream_chunks: 1, delivered_at: '2026-06-08T00:00:00Z',
    }));
    const mockSql = vi.fn().mockResolvedValue(rows);
    const result = await getDeltaHistory(
      mockSql as unknown as Parameters<typeof getDeltaHistory>[0],
      'c1', 'ws1', 20,
    );
    expect(result.isOk()).toBe(true);
    const { entries, nextCursor } = result._unsafeUnwrap();
    expect(entries).toHaveLength(20);
    expect(nextCursor).not.toBeNull();
  });

  it('uses cursor in query when provided', async () => {
    const mockSql = vi.fn().mockResolvedValue([]);
    await getDeltaHistory(
      mockSql as unknown as Parameters<typeof getDeltaHistory>[0],
      'c1', 'ws1', 20, 'cursor-xyz',
    );
    expect(mockSql).toHaveBeenCalledOnce();
  });
});
