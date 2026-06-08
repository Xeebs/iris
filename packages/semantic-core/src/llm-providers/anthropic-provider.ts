import { ok, err } from 'neverthrow';
import type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './types.js';

type AnthropicMessageResponse = {
  id: string;
  content: { type: 'text'; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

/**
 * Completion provider backed by Anthropic Messages API.
 * Uses fetch directly — no SDK dependency required.
 */
export class AnthropicProvider implements LlmCompletionProvider {
  readonly providerId = 'anthropic';
  private static readonly BASE_URL = 'https://api.anthropic.com/v1';

  constructor(
    private readonly apiKey: string,
    readonly modelId: string,
  ) {}

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async complete(messages: CompletionMessage[], options?: CompletionOptions) {
    const systemContent = options?.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: this.modelId,
      max_tokens: options?.maxTokens ?? 2048,
      ...(systemContent ? { system: systemContent } : {}),
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
    };

    try {
      const res = await fetch(`${AnthropicProvider.BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return err(new Error(`Anthropic API error ${res.status}: ${errorText}`));
      }

      const data = await res.json() as AnthropicMessageResponse;
      const textContent = data.content.filter(c => c.type === 'text').map(c => c.text).join('');

      return ok<CompletionResult, Error>({
        content: textContent,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        modelId: data.model,
        providerId: this.providerId,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(`Anthropic completion failed: ${String(e)}`));
    }
  }
}
