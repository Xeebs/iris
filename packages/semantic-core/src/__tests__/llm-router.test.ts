import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateTokens,
  calculateCostUsd,
  buildProvider,
  LlmRouter,
  type WorkspaceProviderConfig,
} from '../llm-router.js';
import { ok, err } from 'neverthrow';

vi.mock('../llm-providers/openai-completion-provider.js', () => ({
  OpenAICompletionProvider: vi.fn().mockImplementation(() => ({
    providerId: 'openai', modelId: 'gpt-4o',
    complete: vi.fn().mockResolvedValue(ok({ content: 'OpenAI response', inputTokens: 10, outputTokens: 5, modelId: 'gpt-4o', providerId: 'openai' })),
    countTokens: (t: string) => Math.ceil(t.length / 4),
  })),
}));

vi.mock('../llm-providers/anthropic-provider.js', () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    providerId: 'anthropic', modelId: 'claude-sonnet-4-6',
    complete: vi.fn().mockResolvedValue(ok({ content: 'Claude response', inputTokens: 8, outputTokens: 6, modelId: 'claude-sonnet-4-6', providerId: 'anthropic' })),
    countTokens: (t: string) => Math.ceil(t.length / 4),
  })),
}));

vi.mock('../llm-providers/google-provider.js', () => ({
  GoogleProvider: vi.fn().mockImplementation(() => ({
    providerId: 'google', modelId: 'gemini-1.5-pro',
    complete: vi.fn().mockResolvedValue(ok({ content: 'Gemini response', inputTokens: 7, outputTokens: 5, modelId: 'gemini-1.5-pro', providerId: 'google' })),
    countTokens: (t: string) => Math.ceil(t.length / 4),
  })),
}));

vi.mock('../llm-providers/ollama-completion-provider.js', () => ({
  OllamaCompletionProvider: vi.fn().mockImplementation(() => ({
    providerId: 'ollama', modelId: 'llama3',
    complete: vi.fn().mockResolvedValue(ok({ content: 'Ollama response', inputTokens: 5, outputTokens: 4, modelId: 'llama3', providerId: 'ollama' })),
    countTokens: (t: string) => Math.ceil(t.length / 4),
  })),
}));

// ─── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('divides length by 4 and rounds up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('hello world')).toBe(3);
  });
});

// ─── calculateCostUsd ─────────────────────────────────────────────────────────

describe('calculateCostUsd', () => {
  it('returns 0 for 0 tokens', () => {
    expect(calculateCostUsd(0, 5)).toBe(0);
  });

  it('calculates cost correctly for 1M tokens', () => {
    expect(calculateCostUsd(1_000_000, 5)).toBeCloseTo(5.0, 5);
  });

  it('calculates cost for partial million', () => {
    expect(calculateCostUsd(500_000, 10)).toBeCloseTo(5.0, 5);
  });
});

// ─── buildProvider ────────────────────────────────────────────────────────────

describe('buildProvider', () => {
  const baseConfig: WorkspaceProviderConfig = {
    configId: 'c1', workspaceId: 'ws1', modelId: 'gpt-4o',
    apiKeyEncrypted: 'key', costPer1mTokens: 5,
    defaultForUseCase: 'completion', endpoint: null, createdAt: new Date(),
    providerId: 'openai',
  };

  it('creates OpenAICompletionProvider for openai providerId', () => {
    const p = buildProvider({ ...baseConfig, providerId: 'openai' });
    expect(p.providerId).toBe('openai');
  });

  it('creates AnthropicProvider for anthropic providerId', () => {
    const p = buildProvider({ ...baseConfig, providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
    expect(p.providerId).toBe('anthropic');
  });

  it('creates GoogleProvider for google providerId', () => {
    const p = buildProvider({ ...baseConfig, providerId: 'google', modelId: 'gemini-1.5-pro' });
    expect(p.providerId).toBe('google');
  });

  it('creates OllamaCompletionProvider for ollama providerId', () => {
    const p = buildProvider({ ...baseConfig, providerId: 'ollama', modelId: 'llama3', endpoint: 'http://localhost:11434' });
    expect(p.providerId).toBe('ollama');
  });
});

// ─── LlmRouter ────────────────────────────────────────────────────────────────

function makeRow(providerId: string, modelId: string) {
  return {
    config_id: 'cfg-1',
    workspace_id: 'ws-1',
    provider_id: providerId,
    model_id: modelId,
    api_key_encrypted: 'key',
    cost_per_1m_tokens: 5,
    default_for_use_case: 'completion',
    endpoint: null,
    created_at: new Date().toISOString(),
  };
}

describe('LlmRouter.route', () => {
  it('returns err when no provider configured', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.route('ws-1');
    expect(result.isErr()).toBe(true);
  });

  it('returns provider when config found', async () => {
    const sql = vi.fn().mockResolvedValue([makeRow('openai', 'gpt-4o')]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.route('ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().providerId).toBe('openai');
  });

  it('caches provider on second call', async () => {
    const sql = vi.fn().mockResolvedValue([makeRow('anthropic', 'claude-sonnet-4-6')]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    await router.route('ws-1');
    await router.route('ws-1');
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('returns err when SQL throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('DB down'));
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.route('ws-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('LlmRouter.complete', () => {
  it('routes and calls complete on the provider', async () => {
    const sql = vi.fn().mockResolvedValue([makeRow('openai', 'gpt-4o')]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.complete([{ role: 'user', content: 'Hello' }], 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().content).toBe('OpenAI response');
  });

  it('returns err when routing fails', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.complete([{ role: 'user', content: 'Hi' }], 'ws-unknown');
    expect(result.isErr()).toBe(true);
  });
});

describe('LlmRouter.registerProvider', () => {
  it('inserts provider config and returns config_id', async () => {
    const sql = vi.fn().mockResolvedValue([{ config_id: 'new-cfg' }]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.registerProvider({
      workspaceId: 'ws-1', providerId: 'anthropic', modelId: 'claude-sonnet-4-6',
      apiKeyEncrypted: 'key', costPer1mTokens: 3,
      defaultForUseCase: 'completion', endpoint: null,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('new-cfg');
  });
});

describe('LlmRouter.deregisterProvider', () => {
  it('returns ok on successful delete', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.deregisterProvider('cfg-1', 'ws-1');
    expect(result.isOk()).toBe(true);
  });
});

describe('LlmRouter.listProviders', () => {
  it('returns providers without api_key_encrypted field', async () => {
    const sql = vi.fn().mockResolvedValue([{
      config_id: 'c1', workspace_id: 'ws-1', provider_id: 'openai',
      model_id: 'gpt-4o', cost_per_1m_tokens: 5,
      default_for_use_case: 'completion', endpoint: null,
      created_at: new Date().toISOString(),
    }]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    const result = await router.listProviders('ws-1');
    expect(result.isOk()).toBe(true);
    const providers = result._unsafeUnwrap();
    expect(providers).toHaveLength(1);
    expect(providers[0]).not.toHaveProperty('apiKeyEncrypted');
    expect(providers[0]?.providerId).toBe('openai');
  });
});

describe('LlmRouter.invalidateCache', () => {
  it('forces re-fetch after invalidation', async () => {
    const sql = vi.fn().mockResolvedValue([makeRow('openai', 'gpt-4o')]);
    const router = new LlmRouter(sql as unknown as Parameters<typeof LlmRouter>[0]);
    await router.route('ws-1');
    router.invalidateCache('ws-1');
    await router.route('ws-1');
    expect(sql).toHaveBeenCalledTimes(2);
  });
});
