import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceStreamManager } from '../resource-streaming.js';
import type { EntitySummary } from '../resource-streaming.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(...responses: unknown[][]) {
  let idx = 0;
  return vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] ?? []));
}

const ENTITIES: EntitySummary[] = [
  { id: 'deal-1', type: 'deal', label: 'Acme Corp Deal', attributes: { amount: 50000, stage: 'qualified', owner: 'alice' }, relationships: [{ type: 'belongs_to', targetId: 'company-1' }] },
  { id: 'deal-2', type: 'deal', label: 'Big Corp Deal', attributes: { amount: 120000, stage: 'proposal' }, relationships: [] },
  { id: 'contact-1', type: 'contact', label: 'John Smith', attributes: { email: 'john@example.com', company: 'Acme' }, relationships: [{ type: 'works_at', targetId: 'company-1' }] },
];

describe('ResourceStreamManager.buildChunks', () => {
  const mgr = new ResourceStreamManager(makeSql() as unknown as ReturnType<typeof import('postgres').default>);

  it('builds summary chunks with type and label only', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'summary', 2000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.content).toBe('deal: Acme Corp Deal');
    expect(chunks[0]?.expansionLevel).toBe('summary');
  });

  it('builds detailed chunks including attributes', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'detailed', 2000);
    expect(chunks[0]?.content).toContain('amount: 50000');
    expect(chunks[0]?.content).toContain('stage: qualified');
  });

  it('builds full chunks including relationships', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'full', 2000);
    expect(chunks[0]?.content).toContain('belongs_to');
    expect(chunks[0]?.content).toContain('company-1');
  });

  it('stops adding chunks when budget is exhausted', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'summary', 8);
    expect(chunks.length).toBeLessThan(ENTITIES.length);
  });

  it('returns empty array when budget is 0', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'summary', 0);
    expect(chunks).toHaveLength(0);
  });

  it('respects fieldFilter — omits unlisted attributes in detailed level', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'detailed', 2000, ['amount']);
    expect(chunks[0]?.content).toContain('amount: 50000');
    expect(chunks[0]?.content).not.toContain('stage');
  });

  it('includes all attributes when fieldFilter is undefined', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'detailed', 2000);
    expect(chunks[0]?.content).toContain('stage: qualified');
    expect(chunks[0]?.content).toContain('owner: alice');
  });

  it('assigns entityId from the entity', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'summary', 2000);
    expect(chunks[0]?.entityId).toBe('deal-1');
    expect(chunks[1]?.entityId).toBe('deal-2');
  });

  it('assigns non-zero tokenCount to each chunk', () => {
    const chunks = mgr.buildChunks(ENTITIES, 'detailed', 2000);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });
});

describe('ResourceStreamManager.startSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new session when none exists', async () => {
    const sql = makeSql([], []);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.startSession('ws-1', 'client-1', 'show deals', 'summary');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().sessionId).toBeTruthy();
    expect(result._unsafeUnwrap().expansionLevel).toBe('summary');
  });

  it('returns existing session when one is found', async () => {
    const existingRow = [{
      session_id: 'existing-session',
      expansion_level: 'summary',
      cached_results_json: [],
      created_at: new Date(),
      expires_at: new Date(Date.now() + 300_000),
    }];
    const sql = makeSql(existingRow);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.startSession('ws-1', 'client-1', 'show deals', 'summary');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().sessionId).toBe('existing-session');
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB fail'));
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.startSession('ws-1', 'client-1', 'query', 'summary');
    expect(result.isErr()).toBe(true);
  });
});

describe('ResourceStreamManager.expandSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns err when session is not found', async () => {
    const sql = makeSql([]);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.expandSession('nonexistent', 'detailed', ENTITIES);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Session not found');
  });

  it('returns err when trying to expand to same or lower level', async () => {
    const sql = makeSql([], []);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    await mgr.startSession('ws-1', 'c-1', 'q', 'detailed');
    const sessionId = (await mgr.startSession('ws-1', 'c-1', 'q-new', 'detailed'))._unsafeUnwrap().sessionId;
    const result = await mgr.expandSession(sessionId, 'summary', ENTITIES);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('expand upward');
  });

  it('returns new chunks at the expanded level', async () => {
    const sql = makeSql([], [], []);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const session = (await mgr.startSession('ws-1', 'c-1', 'q', 'summary'))._unsafeUnwrap();
    const result = await mgr.expandSession(session.sessionId, 'detailed', ENTITIES);
    expect(result.isOk()).toBe(true);
    const chunks = result._unsafeUnwrap();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.expansionLevel).toBe('detailed');
  });
});

describe('ResourceStreamManager.cancelSession', () => {
  it('marks the session as cancelled and expires it', async () => {
    const sql = makeSql([], []);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const session = (await mgr.startSession('ws-1', 'c-1', 'q', 'summary'))._unsafeUnwrap();
    const cancelResult = await mgr.cancelSession(session.sessionId);
    expect(cancelResult.isOk()).toBe(true);
  });
});

describe('ResourceStreamManager.cleanup', () => {
  it('returns the count of evicted sessions', async () => {
    const sql = makeSql([{ session_id: 's-1' }, { session_id: 's-2' }]);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.cleanup();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(2);
  });

  it('returns 0 when no expired sessions', async () => {
    const sql = makeSql([]);
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.cleanup();
    expect(result._unsafeUnwrap()).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const mgr = new ResourceStreamManager(sql as unknown as ReturnType<typeof import('postgres').default>);
    const result = await mgr.cleanup();
    expect(result.isErr()).toBe(true);
  });
});
