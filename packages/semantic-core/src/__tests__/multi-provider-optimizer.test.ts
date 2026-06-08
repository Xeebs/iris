import { describe, it, expect, vi } from 'vitest';

import {
  estimateTokenCount,
  serializeContext,
  MultiProviderOptimizer,
  type ContextChunk,
} from '../multi-provider-optimizer.js';

import { listProviders, getProviderSpec } from '../providers/provider-registry.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
function makeSql(responses: unknown[][]): Sql {
  let idx = 0;
  const fn = vi.fn(async () => responses[idx++] ?? []);
  return fn as unknown as Sql;
}

const CHUNKS: ContextChunk[] = [
  { entityId: 'deal:1', content: 'Deal with Acme Corp, value $50k', tokenEstimate: 10 },
  { entityId: 'contact:2', content: 'John Doe at Acme, VP Sales', tokenEstimate: 8 },
];

describe('estimateTokenCount', () => {
  it('returns ceiling of text.length / 4', () => {
    expect(estimateTokenCount('hello world', 'openai')).toBe(3);
    expect(estimateTokenCount('a'.repeat(100), 'anthropic')).toBe(25);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('', 'openai')).toBe(0);
  });
});

describe('serializeContext', () => {
  it('formats as JSON for openai format', () => {
    const out = serializeContext(CHUNKS, 'json');
    const parsed = JSON.parse(out) as Array<{ id: string; context: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe('deal:1');
  });

  it('wraps in <context> tags for xml format', () => {
    const out = serializeContext(CHUNKS, 'xml');
    expect(out).toContain('<context>');
    expect(out).toContain('<entity id="deal:1">');
    expect(out).toContain('</context>');
  });

  it('formats as markdown headers', () => {
    const out = serializeContext(CHUNKS, 'markdown');
    expect(out).toContain('### deal:1');
    expect(out).toContain('---');
  });

  it('formats as plain bracketed text', () => {
    const out = serializeContext(CHUNKS, 'plain');
    expect(out).toContain('[deal:1]');
    expect(out).toContain('[contact:2]');
  });

  it('escapes < and > in xml format', () => {
    const chunks: ContextChunk[] = [{ entityId: 'e:1', content: 'a < b > c', tokenEstimate: 5 }];
    const out = serializeContext(chunks, 'xml');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('returns empty string for empty chunks', () => {
    expect(serializeContext([], 'json')).toBe('[]');
    expect(serializeContext([], 'xml')).toBe('<context>\n\n</context>');
  });
});

describe('MultiProviderOptimizer.optimizeContext', () => {
  it('returns all chunks when within budget', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const result = svc.optimizeContext('openai', CHUNKS, 1000);
    expect(result.truncated).toBe(false);
    expect(result.format).toBe('json');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('truncates when over budget', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const result = svc.optimizeContext('openai', CHUNKS, 5);
    expect(result.truncated).toBe(true);
  });

  it('uses anthropic json format', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const result = svc.optimizeContext('anthropic', CHUNKS, 1000);
    expect(result.format).toBe('json');
  });

  it('uses google xml format', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const result = svc.optimizeContext('google', CHUNKS, 1000);
    expect(result.format).toBe('xml');
  });

  it('uses ollama markdown format', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const result = svc.optimizeContext('ollama', CHUNKS, 1000);
    expect(result.format).toBe('markdown');
  });

  it('defaults budget to contextWindowTokens / 4', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const spec = getProviderSpec('openai');
    const result = svc.optimizeContext('openai', CHUNKS);
    expect(result.truncated).toBe(false);
    expect(result.tokenCount).toBeLessThanOrEqual(spec.contextWindowTokens / 4);
  });
});

describe('MultiProviderOptimizer.estimateCosts', () => {
  it('returns one entry per registered provider', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const costs = svc.estimateCosts(1000, 500);
    expect(costs.length).toBe(listProviders().length);
  });

  it('returns results sorted by totalCostUsd ascending', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const costs = svc.estimateCosts(10_000, 2_000);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]!.totalCostUsd).toBeGreaterThanOrEqual(costs[i - 1]!.totalCostUsd);
    }
  });

  it('includes ollama with zero cost', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const costs = svc.estimateCosts(1000, 500);
    const ollama = costs.find((c) => c.providerId === 'ollama');
    expect(ollama?.totalCostUsd).toBe(0);
  });

  it('adds embedding cost when embeddingTokens provided', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const withoutEmbed = svc.estimateCosts(1000, 500, 0).find((c) => c.providerId === 'openai')!;
    const withEmbed = svc.estimateCosts(1000, 500, 10_000).find((c) => c.providerId === 'openai')!;
    expect(withEmbed.totalCostUsd).toBeGreaterThan(withoutEmbed.totalCostUsd);
    expect(withEmbed.embeddingCostUsd).toBeGreaterThan(0);
  });

  it('returns 0 embedding cost for anthropic (no embedding model)', () => {
    const svc = new MultiProviderOptimizer(makeSql([]));
    const costs = svc.estimateCosts(1000, 500, 5000);
    const claude = costs.find((c) => c.providerId === 'anthropic')!;
    expect(claude.embeddingCostUsd).toBe(0);
  });
});

describe('MultiProviderOptimizer.selectProvider', () => {
  it('returns highest-priority provider that fits context size', async () => {
    const rows = [
      { workspace_id: 'ws-1', provider_id: 'ollama', priority: '1', is_enabled: true },
      { workspace_id: 'ws-1', provider_id: 'openai', priority: '2', is_enabled: true },
    ];
    const svc = new MultiProviderOptimizer(makeSql([rows]));
    // ollama context window = 32768 tokens; request 5000 tokens → ollama fits
    const result = await svc.selectProvider('ws-1', 5000);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().id).toBe('ollama');
  });

  it('falls back to next provider when first cannot fit context', async () => {
    const rows = [
      { workspace_id: 'ws-1', provider_id: 'ollama', priority: '1', is_enabled: true },
      { workspace_id: 'ws-1', provider_id: 'anthropic', priority: '2', is_enabled: true },
    ];
    const svc = new MultiProviderOptimizer(makeSql([rows]));
    // Ollama context = 32768; request 200000 → falls through to anthropic (200000)
    const result = await svc.selectProvider('ws-1', 200_000);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().id).toBe('anthropic');
  });

  it('falls back to openai when no configured providers fit', async () => {
    const svc = new MultiProviderOptimizer(makeSql([[]]));
    const result = await svc.selectProvider('ws-1', 1000);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().id).toBe('openai');
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('timeout'));
    const svc = new MultiProviderOptimizer(sql as unknown as Sql);
    const result = await svc.selectProvider('ws-1', 1000);
    expect(result.isErr()).toBe(true);
  });
});

describe('MultiProviderOptimizer.saveProviderConfig', () => {
  it('returns ok on success', async () => {
    const svc = new MultiProviderOptimizer(makeSql([[]]));
    const result = await svc.saveProviderConfig('ws-1', 'anthropic', 1, true);
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db fail'));
    const svc = new MultiProviderOptimizer(sql as unknown as Sql);
    const result = await svc.saveProviderConfig('ws-1', 'anthropic', 1, true);
    expect(result.isErr()).toBe(true);
  });
});

describe('MultiProviderOptimizer.listWorkspaceProviders', () => {
  it('returns mapped provider config list', async () => {
    const rows = [
      { workspace_id: 'ws-1', provider_id: 'openai', priority: '1', is_enabled: true },
      { workspace_id: 'ws-1', provider_id: 'anthropic', priority: '2', is_enabled: false },
    ];
    const svc = new MultiProviderOptimizer(makeSql([rows]));
    const result = await svc.listWorkspaceProviders('ws-1');
    expect(result.isOk()).toBe(true);
    const val = result._unsafeUnwrap();
    expect(val).toHaveLength(2);
    expect(val[0]?.providerId).toBe('openai');
    expect(val[1]?.isEnabled).toBe(false);
  });
});

describe('provider registry', () => {
  it('all providers have non-zero context windows', () => {
    listProviders().forEach((spec) => {
      expect(spec.contextWindowTokens).toBeGreaterThan(0);
    });
  });

  it('anthropic supports prefix cache', () => {
    expect(getProviderSpec('anthropic').supportsPrefixCache).toBe(true);
  });

  it('anthropic has no embedding model', () => {
    expect(getProviderSpec('anthropic').embeddingModelId).toBeNull();
  });

  it('google uses xml format', () => {
    expect(getProviderSpec('google').preferredSerializationFormat).toBe('xml');
  });
});
