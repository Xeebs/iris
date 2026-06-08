export type LlmProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'mistral'
  | 'cohere';

export type SerializationFormat = 'json' | 'xml' | 'markdown' | 'plain';

export interface LlmProviderSpec {
  id: LlmProviderId;
  name: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  supportsStreaming: boolean;
  supportsPrefixCache: boolean;
  preferredSerializationFormat: SerializationFormat;
  embeddingModelId: string | null;
  embeddingDimensions: number | null;
  embeddingCostPer1kTokens: number | null;
}

export const PROVIDER_REGISTRY: Record<LlmProviderId, LlmProviderSpec> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    inputCostPer1kTokens: 0.005,
    outputCostPer1kTokens: 0.015,
    supportsStreaming: true,
    supportsPrefixCache: false,
    preferredSerializationFormat: 'json',
    embeddingModelId: 'text-embedding-3-small',
    embeddingDimensions: 1536,
    embeddingCostPer1kTokens: 0.00002,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    contextWindowTokens: 200_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    supportsStreaming: true,
    supportsPrefixCache: true,
    preferredSerializationFormat: 'json',
    embeddingModelId: null,
    embeddingDimensions: null,
    embeddingCostPer1kTokens: null,
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.00125,
    outputCostPer1kTokens: 0.005,
    supportsStreaming: true,
    supportsPrefixCache: false,
    preferredSerializationFormat: 'xml',
    embeddingModelId: 'text-embedding-004',
    embeddingDimensions: 768,
    embeddingCostPer1kTokens: 0.00001,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    supportsStreaming: true,
    supportsPrefixCache: false,
    preferredSerializationFormat: 'markdown',
    embeddingModelId: 'nomic-embed-text',
    embeddingDimensions: 768,
    embeddingCostPer1kTokens: 0,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.002,
    outputCostPer1kTokens: 0.006,
    supportsStreaming: true,
    supportsPrefixCache: false,
    preferredSerializationFormat: 'json',
    embeddingModelId: 'mistral-embed',
    embeddingDimensions: 1024,
    embeddingCostPer1kTokens: 0.00001,
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    supportsStreaming: true,
    supportsPrefixCache: false,
    preferredSerializationFormat: 'plain',
    embeddingModelId: 'embed-english-v3.0',
    embeddingDimensions: 1024,
    embeddingCostPer1kTokens: 0.0001,
  },
};

/**
 * Returns the spec for a provider, or null if not found.
 *
 * @param id - Provider ID
 */
export function getProviderSpec(id: LlmProviderId): LlmProviderSpec {
  return PROVIDER_REGISTRY[id];
}

/**
 * Returns all registered provider specs.
 */
export function listProviders(): LlmProviderSpec[] {
  return Object.values(PROVIDER_REGISTRY);
}
