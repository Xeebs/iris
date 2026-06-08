import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  QueryAnalyticsEngine,
  computeQuerySignature,
  extractEntityTypes,
  type AnalyticsStore,
  type QueryEvent,
  type QueryPattern,
  type CacheWarmingJob,
} from '../query-analytics-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    queryId: 'q1',
    workspaceId: 'ws-1',
    queryText: 'show me all contacts at Acme',
    querySignature: computeQuerySignature('show me all contacts at Acme'),
    entityTypes: ['contact'],
    cacheHit: false,
    latencyMs: 120,
    tokensSpent: 400,
    timestamp: new Date(),
    ...overrides,
  };
}

function makeStore(events: QueryEvent[] = []): AnalyticsStore {
  const storedEvents = [...events];
  const patterns: QueryPattern[] = [];
  const jobs: CacheWarmingJob[] = [];
  const sigs = new Map<string, { count: number; lastSeen: Date }>();

  for (const e of storedEvents) {
    const existing = sigs.get(e.querySignature);
    if (existing) {
      existing.count++;
      if (e.timestamp > existing.lastSeen) existing.lastSeen = e.timestamp;
    } else {
      sigs.set(e.querySignature, { count: 1, lastSeen: e.timestamp });
    }
  }

  return {
    recordEvent: vi.fn(async (event) => {
      storedEvents.push(event);
      const existing = sigs.get(event.querySignature);
      if (existing) {
        existing.count++;
        if (event.timestamp > existing.lastSeen) existing.lastSeen = event.timestamp;
      } else {
        sigs.set(event.querySignature, { count: 1, lastSeen: event.timestamp });
      }
    }),
    getRecentEvents: vi.fn(async () => [...storedEvents]),
    getPatterns: vi.fn(async () => [...patterns]),
    savePattern: vi.fn(async (p) => { patterns.push(p); }),
    recordWarmingJob: vi.fn(async (j) => { jobs.push(j); }),
    getTopSignatures: vi.fn(async (_wId, limit = 20) => {
      return [...sigs.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([sig, { count, lastSeen }]) => ({ signature: sig, count, lastSeen }));
    }),
  };
}

// ---------------------------------------------------------------------------
// computeQuerySignature
// ---------------------------------------------------------------------------

describe('computeQuerySignature', () => {
  it('returns a 12-char hex string', () => {
    const sig = computeQuerySignature('show me contacts at Acme Corp');
    expect(sig).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is case-insensitive', () => {
    expect(computeQuerySignature('Contacts at ACME')).toBe(computeQuerySignature('contacts at acme'));
  });

  it('normalises entity type aliases', () => {
    // "contacts" → "contact", "companies" → "company"
    const a = computeQuerySignature('contacts at top companies');
    const b = computeQuerySignature('contact at top company');
    expect(a).toBe(b);
  });

  it('produces different signatures for unrelated queries', () => {
    const a = computeQuerySignature('contacts at Acme');
    const b = computeQuerySignature('upcoming meetings next week');
    expect(a).not.toBe(b);
  });

  it('is stable across calls', () => {
    const text = 'open deals in pipeline';
    expect(computeQuerySignature(text)).toBe(computeQuerySignature(text));
  });

  it('strips stop words', () => {
    const a = computeQuerySignature('show me all the contacts');
    const b = computeQuerySignature('contacts');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// extractEntityTypes
// ---------------------------------------------------------------------------

describe('extractEntityTypes', () => {
  it('extracts contact entity type', () => {
    expect(extractEntityTypes('show all contacts')).toContain('contact');
  });

  it('canonicalises plural aliases', () => {
    const types = extractEntityTypes('list deals and opportunities');
    expect(types).toContain('deal');
    expect(types.filter((t) => t === 'deal')).toHaveLength(1);
  });

  it('returns empty array for unknown entity types', () => {
    expect(extractEntityTypes('what is the weather today')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine.trackQuery
// ---------------------------------------------------------------------------

describe('QueryAnalyticsEngine.trackQuery', () => {
  it('records a query event with computed signature', async () => {
    const store = makeStore();
    const engine = new QueryAnalyticsEngine(store);

    await engine.trackQuery('ws-1', 'show contacts at Acme', false, 150, 300);
    expect(store.recordEvent).toHaveBeenCalledOnce();
    const called = vi.mocked(store.recordEvent).mock.calls[0]![0];
    expect(called.workspaceId).toBe('ws-1');
    expect(called.querySignature).toBe(computeQuerySignature('show contacts at Acme'));
    expect(called.cacheHit).toBe(false);
    expect(called.latencyMs).toBe(150);
  });

  it('attaches userId when provided', async () => {
    const store = makeStore();
    const engine = new QueryAnalyticsEngine(store);

    await engine.trackQuery('ws-1', 'deals this quarter', false, 80, 200, 'user-abc');
    const called = vi.mocked(store.recordEvent).mock.calls[0]![0];
    expect(called.userId).toBe('user-abc');
  });
});

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine.detectQueryPatterns
// ---------------------------------------------------------------------------

describe('QueryAnalyticsEngine.detectQueryPatterns', () => {
  it('returns empty array with no events', async () => {
    const engine = new QueryAnalyticsEngine(makeStore([]));
    const patterns = await engine.detectQueryPatterns('ws-1');
    expect(patterns).toHaveLength(0);
  });

  it('detects a temporal pattern for a spike hour', async () => {
    const spikeHour = 9;
    // Create 30 events at hour 9 and a few at other hours
    const events: QueryEvent[] = Array.from({ length: 30 }, (_, i) => {
      const ts = new Date();
      ts.setHours(spikeHour, i, 0, 0);
      return makeEvent({ queryId: `q${i}`, timestamp: ts, entityTypes: ['contact'] });
    });
    for (let i = 0; i < 5; i++) {
      const ts = new Date();
      ts.setHours(14, i, 0, 0);
      events.push(makeEvent({ queryId: `other${i}`, timestamp: ts }));
    }

    const store = makeStore(events);
    const engine = new QueryAnalyticsEngine(store);
    const patterns = await engine.detectQueryPatterns('ws-1');

    const temporal = patterns.filter((p) => p.patternType === 'temporal');
    expect(temporal.length).toBeGreaterThan(0);
    expect(store.savePattern).toHaveBeenCalled();
  });

  it('detects a user pattern for a frequent user', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({
        queryId: `q${i}`,
        userId: 'user-xyz',
        entityTypes: ['contact'],
        timestamp: new Date(Date.now() - i * 60_000),
      }),
    );

    const engine = new QueryAnalyticsEngine(makeStore(events));
    const patterns = await engine.detectQueryPatterns('ws-1');

    const userPatterns = patterns.filter((p) => p.patternType === 'user');
    expect(userPatterns.length).toBeGreaterThan(0);
    expect((userPatterns[0]!.definition as { userId: string }).userId).toBe('user-xyz');
  });
});

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine.predictCacheHit
// ---------------------------------------------------------------------------

describe('QueryAnalyticsEngine.predictCacheHit', () => {
  it('returns 0 for a never-seen query', async () => {
    const engine = new QueryAnalyticsEngine(makeStore([]));
    const score = await engine.predictCacheHit('ws-1', 'brand new query');
    expect(score).toBe(0);
  });

  it('returns higher score for a frequently-seen signature', async () => {
    const query = 'contacts at Acme Corp';
    const sig = computeQuerySignature(query);
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ queryId: `q${i}`, queryText: query, querySignature: sig }),
    );

    const engine = new QueryAnalyticsEngine(makeStore(events));
    const score = await engine.predictCacheHit('ws-1', query);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine.warmCache
// ---------------------------------------------------------------------------

describe('QueryAnalyticsEngine.warmCache', () => {
  it('calls executeWarming for candidates above threshold', async () => {
    const query = 'top contacts';
    const sig = computeQuerySignature(query);
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ queryId: `q${i}`, queryText: query, querySignature: sig }),
    );

    const store = makeStore(events);
    const engine = new QueryAnalyticsEngine(store);
    const execute = vi.fn().mockResolvedValue(undefined);

    await engine.warmCache('ws-1', execute, 0.5);
    expect(store.recordWarmingJob).toHaveBeenCalledOnce();
  });

  it('records a warming job even when no candidates meet the threshold', async () => {
    const store = makeStore([]);
    const engine = new QueryAnalyticsEngine(store);

    await engine.warmCache('ws-1', vi.fn(), 0.9);
    expect(store.recordWarmingJob).toHaveBeenCalledOnce();
  });

  it('continues when executeWarming throws for one signature', async () => {
    const sig = computeQuerySignature('contacts');
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ queryId: `q${i}`, querySignature: sig }),
    );
    const store = makeStore(events);
    const engine = new QueryAnalyticsEngine(store);
    const execute = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(engine.warmCache('ws-1', execute, 0.1)).resolves.toBeDefined();
    expect(store.recordWarmingJob).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// QueryAnalyticsEngine.getPatterns / getTopSignatures
// ---------------------------------------------------------------------------

describe('QueryAnalyticsEngine.getPatterns', () => {
  it('delegates to store.getPatterns', async () => {
    const store = makeStore();
    const engine = new QueryAnalyticsEngine(store);
    await engine.getPatterns('ws-1');
    expect(store.getPatterns).toHaveBeenCalledWith('ws-1');
  });
});

describe('QueryAnalyticsEngine.getTopSignatures', () => {
  it('returns top signatures sorted by frequency', async () => {
    const events = [
      makeEvent({ queryId: 'q1', querySignature: 'aaa', queryText: 'a' }),
      makeEvent({ queryId: 'q2', querySignature: 'aaa', queryText: 'a' }),
      makeEvent({ queryId: 'q3', querySignature: 'bbb', queryText: 'b' }),
    ];
    const engine = new QueryAnalyticsEngine(makeStore(events));
    const sigs = await engine.getTopSignatures('ws-1', 10);
    expect(sigs[0]?.signature).toBe('aaa');
    expect(sigs[0]?.count).toBe(2);
  });
});
