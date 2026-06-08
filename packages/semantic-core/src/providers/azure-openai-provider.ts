import { AzureOpenAI } from 'openai';
import { IndexerError } from '@iris/core/errors';
import type { EmbeddingProvider } from '../embedding-provider.js';

type AzureConfig = {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deployment: string;
};

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const BATCH_SIZE = 100;

export class AzureOpenAIProvider implements EmbeddingProvider {
  private readonly client: AzureOpenAI;
  private readonly deployment: string;

  constructor(config: AzureConfig) {
    if (!config.endpoint || !config.apiKey) {
      throw new IndexerError('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required');
    }
    this.deployment = config.deployment;
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.deployment,
    });
  }

  getModelId(): string {
    return this.deployment;
  }

  getModelDimensions(): number {
    return MODEL_DIMENSIONS[this.deployment] ?? 1536;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const results = await this.batchEmbeddings([text]);
    return results[0]!;
  }

  async batchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      let response;
      try {
        response = await this.client.embeddings.create({ model: this.deployment, input: batch });
      } catch (e) {
        throw new IndexerError(
          `Azure OpenAI embedding failed (deployment: ${this.deployment}): ${e instanceof Error ? e.message : String(e)}`,
          e,
        );
      }
      for (const item of response.data) {
        out[i + item.index] = item.embedding;
      }
    }

    return out;
  }
}
