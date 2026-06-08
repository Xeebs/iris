import OpenAI from 'openai';
import { ok, err } from 'neverthrow';
import type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './types.js';

/**
 * Completion provider backed by OpenAI Chat Completions API.
 */
export class OpenAICompletionProvider implements LlmCompletionProvider {
  readonly providerId = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly modelId: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async complete(messages: CompletionMessage[], options?: CompletionOptions) {
    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      openAiMessages.push({ role: 'system', content: options.systemPrompt });
    }
    for (const m of messages) {
      openAiMessages.push({ role: m.role, content: m.content });
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelId,
        messages: openAiMessages,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.2,
      });

      const choice = response.choices[0];
      return ok<CompletionResult, Error>({
        content: choice?.message.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        modelId: this.modelId,
        providerId: this.providerId,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(`OpenAI completion failed: ${String(e)}`));
    }
  }
}
