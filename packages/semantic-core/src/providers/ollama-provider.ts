import { IndexerError } from '@iris/core/errors';
import type { EmbeddingProvider } from '../embedding-provider.js';

const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
};

type OllamaEmbedResponse = {
  embedding: number[];
};

export class OllamaProvider implements EmbeddingProvider {
  constructor(
    private readonly endpoint: string,
    private readonly modelId: string,
  ) {}

  getModelId(): string {
    return this.modelId;
  }

  getModelDimensions(): number {
    return MODEL_DIMENSIONS[this.modelId] ?? 768;
  }

  async getEmbedding(text: string): Promise<number[]> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelId, prompt: text }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new IndexerError(
        `Ollama embedding request failed (model: ${this.modelId}): ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }

    if (!res.ok) {
      throw new IndexerError(`Ollama embedding request failed with status ${res.status}`);
    }

    const body = await res.json() as OllamaEmbedResponse;
    return body.embedding;
  }

  async batchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return Promise.all(texts.map((t) => this.getEmbedding(t)));
  }
}
