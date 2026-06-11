import { IndexerError } from '@iris/core/errors';
import type { EmbeddingProvider } from '../embedding-provider.js';

const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
};

// On CPU-only hosts the first request also pays model load time, so the
// per-request timeout must cover load + inference. Override: OLLAMA_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 120_000;

// Ollama serializes embedding compute, so unbounded fan-out makes later
// requests' wall-clock time exceed any per-request timeout. Keep in-flight
// requests bounded; each request's timeout then only covers its own chunk.
const MAX_CONCURRENT_REQUESTS = 4;

type OllamaEmbedResponse = {
  embedding: number[];
};

export class OllamaProvider implements EmbeddingProvider {
  private readonly timeoutMs: number;

  constructor(
    private readonly endpoint: string,
    private readonly modelId: string,
  ) {
    this.timeoutMs = Number(process.env['OLLAMA_TIMEOUT_MS'] ?? '') || DEFAULT_TIMEOUT_MS;
  }

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
        signal: AbortSignal.timeout(this.timeoutMs),
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
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_CONCURRENT_REQUESTS) {
      const chunk = texts.slice(i, i + MAX_CONCURRENT_REQUESTS);
      results.push(...(await Promise.all(chunk.map((t) => this.getEmbedding(t)))));
    }
    return results;
  }
}
