import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompletionProvider } from '../openai-completion-provider.js';

vi.mock('openai', () => {
  const create = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create } },
    })),
    __create: create,
  };
});

import OpenAI from 'openai';
import * as OpenAIModule from 'openai';

function getCreateFn() {
  return (OpenAIModule as unknown as { __create: ReturnType<typeof vi.fn> }).__create;
}

function makeOpenAIResponse(text: string, promptTokens = 15, completionTokens = 8) {
  return {
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    model: 'gpt-4o',
  };
}

describe('OpenAICompletionProvider', () => {
  let provider: OpenAICompletionProvider;
  let createFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (OpenAI as ReturnType<typeof vi.fn>).mockClear();
    createFn = getCreateFn();
    createFn.mockReset();
    provider = new OpenAICompletionProvider('test-key', 'gpt-4o');
  });

  it('has correct providerId and modelId', () => {
    expect(provider.providerId).toBe('openai');
    expect(provider.modelId).toBe('gpt-4o');
  });

  it('returns completion from OpenAI', async () => {
    createFn.mockResolvedValueOnce(makeOpenAIResponse('Hello!'));
    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);
    expect(result.isOk()).toBe(true);
    const r = result._unsafeUnwrap();
    expect(r.content).toBe('Hello!');
    expect(r.inputTokens).toBe(15);
    expect(r.outputTokens).toBe(8);
    expect(r.providerId).toBe('openai');
  });

  it('prepends system prompt from options', async () => {
    createFn.mockResolvedValueOnce(makeOpenAIResponse('ok'));
    await provider.complete([{ role: 'user', content: 'go' }], { systemPrompt: 'Be brief.' });
    const call = createFn.mock.calls[0][0] as { messages: { role: string; content: string }[] };
    expect(call.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('returns err when OpenAI SDK throws', async () => {
    createFn.mockRejectedValueOnce(new Error('rate limited'));
    const result = await provider.complete([{ role: 'user', content: 'test' }]);
    expect(result.isErr()).toBe(true);
  });

  it('counts tokens with 4-char heuristic', () => {
    expect(provider.countTokens('hello')).toBe(2); // 5 chars → ceil(5/4)=2
    expect(provider.countTokens('abcdefgh')).toBe(2); // 8 chars → 2
  });
});
