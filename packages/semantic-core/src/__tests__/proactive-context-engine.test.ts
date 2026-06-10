import { describe, it, expect, vi } from 'vitest';
import { ProactiveContextEngine } from '../proactive-context-engine.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function makeSql(...responses: unknown[][]) {
  let idx = 0;
  // services call sql.json() for jsonb params; echo the value through
  const fn = Object.assign(
    vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] ?? [])),
    { json: (v: unknown) => v },
  );
  return fn as unknown as ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) & { json(v: unknown): unknown };
}

const profileRow = {
  workspace_id: 'ws-1',
  agent_id: 'agent-1',
  entity_types: ['contact', 'deal', 'company'],
  query_patterns_json: { 'account_review': 5, 'pipeline_check': 3 },
  total_queries: '50',
  learned_at: '2026-06-08T00:00:00Z',
};

const suggestionRow = {
  id: 'sug-1',
  workspace_id: 'ws-1',
  agent_id: 'agent-1',
  entity_types: ['contact', 'deal'],
  context_hints: ['Proactively load recent contact entities'],
  score: '0.5',
  created_at: '2026-06-08T00:00:00Z',
};

// ─── recordQueryEvent ─────────────────────────────────────────────────────────

describe('ProactiveContextEngine.recordQueryEvent', () => {
  it('returns ok on successful upsert', async () => {
    const svc = new ProactiveContextEngine(makeSql([]));
    const result = await svc.recordQueryEvent('ws-1', 'agent-1', ['contact', 'deal'], 'account_review');
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('lock timeout'));
    const svc = new ProactiveContextEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.recordQueryEvent('ws-1', 'agent-1', ['contact'], 'check');
    expect(result.isErr()).toBe(true);
  });
});

// ─── getAgentProfile ──────────────────────────────────────────────────────────

describe('ProactiveContextEngine.getAgentProfile', () => {
  it('returns profile when found', async () => {
    const svc = new ProactiveContextEngine(makeSql([profileRow]));
    const result = await svc.getAgentProfile('ws-1', 'agent-1');
    expect(result.isOk()).toBe(true);
    const p = result._unsafeUnwrap();
    expect(p).not.toBeNull();
    expect(p!.agentId).toBe('agent-1');
    expect(p!.frequentEntityTypes).toContain('contact');
    expect(p!.totalQueries).toBe(50);
  });

  it('returns null when no profile exists', async () => {
    const svc = new ProactiveContextEngine(makeSql([]));
    const result = await svc.getAgentProfile('ws-1', 'unknown-agent');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connection refused'));
    const svc = new ProactiveContextEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.getAgentProfile('ws-1', 'agent-1');
    expect(result.isErr()).toBe(true);
  });
});

// ─── predictContext ───────────────────────────────────────────────────────────

describe('ProactiveContextEngine.predictContext', () => {
  it('returns empty when profile not found', async () => {
    const svc = new ProactiveContextEngine(makeSql([]));
    const result = await svc.predictContext('ws-1', 'new-agent', 'account review');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns empty when too few queries to learn from', async () => {
    const sparseProfile = { ...profileRow, total_queries: '2' };
    const svc = new ProactiveContextEngine(makeSql([sparseProfile]));
    const result = await svc.predictContext('ws-1', 'agent-1', 'pipeline');
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('generates suggestion based on behavioral profile', async () => {
    const svc = new ProactiveContextEngine(makeSql([profileRow], [suggestionRow]));
    const result = await svc.predictContext('ws-1', 'agent-1', 'quarterly review');
    expect(result.isOk()).toBe(true);
    const suggestions = result._unsafeUnwrap();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.entityTypes).toContain('contact');
    expect(suggestions[0]?.score).toBeCloseTo(0.5);
  });

  it('returns empty when insert returns no row', async () => {
    const svc = new ProactiveContextEngine(makeSql([profileRow], []));
    const result = await svc.predictContext('ws-1', 'agent-1', 'review');
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new ProactiveContextEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.predictContext('ws-1', 'agent-1', 'review');
    expect(result.isErr()).toBe(true);
  });
});

// ─── recordFeedback ───────────────────────────────────────────────────────────

describe('ProactiveContextEngine.recordFeedback', () => {
  it('returns ok on success', async () => {
    const svc = new ProactiveContextEngine(makeSql([]));
    const result = await svc.recordFeedback({
      workspaceId: 'ws-1', agentId: 'agent-1', suggestionId: 'sug-1',
      feedback: 'accepted', feedbackScore: 1.0,
    });
    expect(result.isOk()).toBe(true);
  });

  it('accepts all feedback types', async () => {
    for (const feedback of ['accepted', 'ignored', 'modified'] as const) {
      const svc = new ProactiveContextEngine(makeSql([]));
      const result = await svc.recordFeedback({
        workspaceId: 'ws-1', agentId: 'agent-1', suggestionId: 'sug-1', feedback,
      });
      expect(result.isOk()).toBe(true);
    }
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new ProactiveContextEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.recordFeedback({
      workspaceId: 'ws-1', agentId: 'a', suggestionId: 's', feedback: 'ignored',
    });
    expect(result.isErr()).toBe(true);
  });
});

// ─── saveSettings ─────────────────────────────────────────────────────────────

describe('ProactiveContextEngine.saveSettings', () => {
  it('returns saved settings', async () => {
    const settingsRow = {
      workspace_id: 'ws-1', agent_id: 'agent-1',
      aggressiveness: 'medium' as const,
      enabled_entity_types: ['contact', 'deal'],
      updated_at: '2026-06-08T00:00:00Z',
    };
    const svc = new ProactiveContextEngine(makeSql([settingsRow]));
    const result = await svc.saveSettings('ws-1', 'agent-1', 'medium', ['contact', 'deal']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().aggressiveness).toBe('medium');
    expect(result._unsafeUnwrap().enabledEntityTypes).toContain('contact');
  });

  it('returns err when upsert returns no row', async () => {
    const svc = new ProactiveContextEngine(makeSql([]));
    const result = await svc.saveSettings('ws-1', 'agent-1', 'high', []);
    expect(result.isErr()).toBe(true);
  });
});

// ─── getAcceptanceStats ───────────────────────────────────────────────────────

describe('ProactiveContextEngine.getAcceptanceStats', () => {
  it('returns computed stats', async () => {
    const svc = new ProactiveContextEngine(makeSql([
      { total: '20', accepted: '12', ignored: '5', modified: '3' },
    ]));
    const result = await svc.getAcceptanceStats('ws-1', 'agent-1');
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap();
    expect(stats.total).toBe(20);
    expect(stats.acceptanceRate).toBeCloseTo(0.6);
  });

  it('returns zero acceptanceRate when no feedback', async () => {
    const svc = new ProactiveContextEngine(makeSql([
      { total: '0', accepted: '0', ignored: '0', modified: '0' },
    ]));
    const result = await svc.getAcceptanceStats('ws-1', 'agent-1');
    expect(result._unsafeUnwrap().acceptanceRate).toBe(0);
  });

  it('returns err on DB failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const svc = new ProactiveContextEngine(fn as unknown as ReturnType<typeof makeSql>);
    const result = await svc.getAcceptanceStats('ws-1', 'agent-1');
    expect(result.isErr()).toBe(true);
  });
});
