import type { Result } from 'neverthrow';

export type CompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CompletionOptions = {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
};

export type CompletionResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  providerId: string;
};

export interface LlmCompletionProvider {
  readonly providerId: string;
  readonly modelId: string;
  complete(messages: CompletionMessage[], options?: CompletionOptions): Promise<Result<CompletionResult, Error>>;
  countTokens(text: string): number;
}
