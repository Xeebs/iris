import OpenAI from 'openai';
import { IndexerError } from '@iris/core/errors';
import type { EmbeddingProvider } from '../embedding-provider.js';

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const BATCH_SIZE = 100;

export class OpenAIProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly modelId: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  getModelId(): string {
    return this.modelId;
  }

  getModelDimensions(): number {
    return MODEL_DIMENSIONS[this.modelId] ?? 1536;
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
        response = await this.client.embeddings.create({ model: this.modelId, input: batch });
      } catch (e) {
        throw new IndexerError(
          `OpenAI embedding failed (model: ${this.modelId}): ${e instanceof Error ? e.message : String(e)}`,
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
