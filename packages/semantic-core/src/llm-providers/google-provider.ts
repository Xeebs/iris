import { ok, err } from 'neverthrow';
import type { LlmCompletionProvider, CompletionMessage, CompletionOptions, CompletionResult } from './types.js';

type GeminiContent = { role: 'user' | 'model'; parts: { text: string }[] };

type GeminiResponse = {
  candidates: {
    content: { role: string; parts: { text: string }[] };
    finishReason: string;
  }[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
};

/**
 * Completion provider backed by Google Gemini API.
 * Uses fetch directly — no SDK dependency required.
 */
export class GoogleProvider implements LlmCompletionProvider {
  readonly providerId = 'google';
  private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(
    private readonly apiKey: string,
    readonly modelId: string,
  ) {}

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async complete(messages: CompletionMessage[], options?: CompletionOptions) {
    const systemInstruction = options?.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const contents: GeminiContent[] = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.2,
      },
    };

    try {
      const url = `${GoogleProvider.BASE_URL}/models/${this.modelId}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return err(new Error(`Google Gemini API error ${res.status}: ${errorText}`));
      }

      const data = await res.json() as GeminiResponse;
      const content = data.candidates[0]?.content.parts.map(p => p.text).join('') ?? '';

      return ok<CompletionResult, Error>({
        content,
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
        modelId: this.modelId,
        providerId: this.providerId,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(`Google completion failed: ${String(e)}`));
    }
  }
}
