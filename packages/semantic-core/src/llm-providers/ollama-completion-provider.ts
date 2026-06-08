import { ok, err } from 'neverthrow';
import type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './types.js';

type OllamaChatResponse = {
  message: { role: string; content: string };
  prompt_eval_count: number;
  eval_count: number;
  model: string;
};

/**
 * Completion provider backed by local Ollama API.
 * Uses fetch directly against the Ollama REST endpoint.
 */
export class OllamaCompletionProvider implements LlmCompletionProvider {
  readonly providerId = 'ollama';

  constructor(
    private readonly endpoint: string,
    readonly modelId: string,
  ) {}

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async complete(messages: CompletionMessage[], options?: CompletionOptions) {
    const ollamaMessages = messages.map(m => ({ role: m.role, content: m.content }));
    if (options?.systemPrompt) {
      ollamaMessages.unshift({ role: 'system', content: options.systemPrompt });
    }

    const body = {
      model: this.modelId,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.2,
      },
    };

    try {
      const res = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return err(new Error(`Ollama API error ${res.status}: ${errorText}`));
      }

      const data = await res.json() as OllamaChatResponse;

      return ok<CompletionResult, Error>({
        content: data.message.content,
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        modelId: data.model,
        providerId: this.providerId,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(`Ollama completion failed: ${String(e)}`));
    }
  }
}
