import { IndexerError } from '@iris/core/errors';
import type { EmbeddingProvider } from '../embedding-provider.js';

const MODEL_DIMENSIONS: Record<string, number> = {
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  'embed-english-light-v3.0': 384,
  'embed-multilingual-light-v3.0': 384,
  'embed-english-v2.0': 4096,
};

const BATCH_SIZE = 96; // Cohere max is 96 texts per call

type CohereEmbedResponse = {
  embeddings: number[][];
};

export class CohereProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {
    if (!apiKey) {
      throw new IndexerError('COHERE_API_KEY is required for CohereProvider');
    }
  }

  getModelId(): string {
    return this.modelId;
  }

  getModelDimensions(): number {
    return MODEL_DIMENSIONS[this.modelId] ?? 1024;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const results = await this.batchEmbeddings([text]);
    return results[0]!;
  }

  async batchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      let res: Response;
      try {
        res = await fetch('https://api.cohere.ai/v1/embed', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            texts: batch,
            model: this.modelId,
            input_type: 'search_document',
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        throw new IndexerError(
          `Cohere embedding request failed (model: ${this.modelId}): ${e instanceof Error ? e.message : String(e)}`,
          e,
        );
      }

      if (!res.ok) {
        const body = await res.text();
        throw new IndexerError(`Cohere embedding failed with status ${res.status}: ${body}`);
      }

      const body = await res.json() as CohereEmbedResponse;
      out.push(...body.embeddings);
    }

    return out;
  }
}
