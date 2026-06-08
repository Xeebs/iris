import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeAnthropicResponse(text: string, inputTokens = 20, outputTokens = 10) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg-1',
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      model: 'claude-sonnet-4-6',
    }),
    text: async () => '',
  } as unknown as Response;
}

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    mockFetch.mockReset();
    provider = new AnthropicProvider('test-api-key', 'claude-sonnet-4-6');
  });

  it('has correct providerId and modelId', () => {
    expect(provider.providerId).toBe('anthropic');
    expect(provider.modelId).toBe('claude-sonnet-4-6');
  });

  it('counts tokens by dividing chars by 4', () => {
    expect(provider.countTokens('hello world')).toBe(3); // 11 chars → ceil(11/4)=3
    expect(provider.countTokens('')).toBe(0);
  });

  it('sends messages to Anthropic API and returns completion', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse('The answer is 42.'));
    const result = await provider.complete([{ role: 'user', content: 'What is the answer?' }]);
    expect(result.isOk()).toBe(true);
    const r = result._unsafeUnwrap();
    expect(r.content).toBe('The answer is 42.');
    expect(r.inputTokens).toBe(20);
    expect(r.outputTokens).toBe(10);
    expect(r.providerId).toBe('anthropic');
  });

  it('passes system prompt in request body', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    await provider.complete(
      [{ role: 'user', content: 'hello' }],
      { systemPrompt: 'You are a helpful assistant.' },
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body['system']).toBe('You are a helpful assistant.');
  });

  it('extracts system role from messages when no systemPrompt option', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    await provider.complete([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
    ]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body['system']).toBe('Be concise.');
    const msgs = body['messages'] as { role: string }[];
    expect(msgs.every(m => m.role !== 'system')).toBe(true);
  });

  it('returns err when API responds with non-200 status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401,
      text: async () => '{"error":"invalid api key"}',
    } as unknown as Response);
    const result = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('401');
  });

  it('returns err when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));
    const result = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(result.isErr()).toBe(true);
  });

  it('sends correct API headers', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    await provider.complete([{ role: 'user', content: 'hi' }]);
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});
