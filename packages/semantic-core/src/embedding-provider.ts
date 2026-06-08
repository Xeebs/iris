import { IndexerError } from '@iris/core/errors';

import { OpenAIProvider } from './providers/openai-provider.js';
import { AzureOpenAIProvider } from './providers/azure-openai-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { CohereProvider } from './providers/cohere-provider.js';

export type EmbeddingProviderType = 'openai' | 'azure' | 'ollama' | 'cohere';

export type EmbeddingProviderConfig = {
  provider: EmbeddingProviderType;
  modelId?: string;
  apiKey?: string;
  endpoint?: string;
  apiVersion?: string;
  deployment?: string;
};

export interface EmbeddingProvider {
  /** Embed a single text string. */
  getEmbedding(text: string): Promise<number[]>;
  /** Embed multiple texts in a single API call (or in batches). */
  batchEmbeddings(texts: string[]): Promise<number[][]>;
  /** Output vector dimensionality for this model. */
  getModelDimensions(): number;
  /** Canonical model identifier string. */
  getModelId(): string;
}

/**
 * Factory that creates an EmbeddingProvider from a config object.
 * Falls back to environment variables when config fields are omitted.
 *
 * @param config - Provider type and optional credentials
 * @returns      - Configured EmbeddingProvider instance
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(
        config.apiKey ?? process.env['OPENAI_API_KEY'] ?? '',
        config.modelId ?? process.env['EMBEDDING_MODEL_ID'] ?? 'text-embedding-3-small',
      );
    case 'azure':
      return new AzureOpenAIProvider({
        endpoint: config.endpoint ?? process.env['AZURE_OPENAI_ENDPOINT'] ?? '',
        apiKey: config.apiKey ?? process.env['AZURE_OPENAI_API_KEY'] ?? '',
        apiVersion: config.apiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2023-05-15',
        deployment: config.deployment ?? process.env['AZURE_OPENAI_SMALL_DEPLOYMENT'] ?? 'text-embedding-3-small',
      });
    case 'ollama':
      return new OllamaProvider(
        config.endpoint ?? process.env['OLLAMA_ENDPOINT'] ?? 'http://localhost:11434',
        config.modelId ?? process.env['EMBEDDING_MODEL_ID'] ?? 'nomic-embed-text',
      );
    case 'cohere':
      return new CohereProvider(
        config.apiKey ?? process.env['COHERE_API_KEY'] ?? '',
        config.modelId ?? process.env['EMBEDDING_MODEL_ID'] ?? 'embed-english-v3.0',
      );
    default: {
      const _exhaustive: never = config.provider;
      throw new IndexerError(`Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Create the default EmbeddingProvider from environment configuration.
 * Reads EMBEDDING_PROVIDER env var; defaults to 'openai'.
 */
export function createDefaultProvider(): EmbeddingProvider {
  const providerType = (process.env['EMBEDDING_PROVIDER'] ?? 'openai') as EmbeddingProviderType;
  return createEmbeddingProvider({ provider: providerType });
}

export { OpenAIProvider, AzureOpenAIProvider, OllamaProvider, CohereProvider };
