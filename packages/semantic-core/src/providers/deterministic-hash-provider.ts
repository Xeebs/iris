import { createHmac } from 'node:crypto';

import type { EmbeddingProvider } from '../embedding-provider.js';

const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_SEED = 'iris-demo';
/** Signed buckets derived per token — multiple projections make collisions less destructive. */
const PROJECTIONS_PER_TOKEN = 3;

/**
 * Deterministic, offline embedding provider for demo/CI mode
 * (EMBEDDING_PROVIDER=hash-deterministic). No API keys, no network.
 *
 * Uses token-level feature hashing rather than hashing the whole text:
 * each lowercase word token is HMAC-hashed (with the seed) to a few signed
 * vector buckets, contributions are summed, and the result is L2-normalized.
 * Identical text always yields the identical vector, and texts that share
 * tokens have higher cosine similarity than unrelated texts — enough signal
 * for fixture-grounded retrieval in scripts/slice-demo.sh. Not a substitute
 * for real semantic embeddings outside demo mode.
 */
export class DeterministicHashProvider implements EmbeddingProvider {
  constructor(
    private readonly seed: string = DEFAULT_SEED,
    private readonly dimensions: number = DEFAULT_DIMENSIONS,
  ) {}

  getModelId(): string {
    return `hash-deterministic-${this.dimensions}`;
  }

  getModelDimensions(): number {
    return this.dimensions;
  }

  getEmbedding(text: string): Promise<number[]> {
    return Promise.resolve(this.embed(text));
  }

  batchEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.embed(t)));
  }

  private embed(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
      const digest = createHmac('sha256', this.seed).update(token).digest();
      for (let p = 0; p < PROJECTIONS_PER_TOKEN; p++) {
        // 4 bytes select the bucket, 1 byte selects the sign, per projection.
        const offset = p * 5;
        const bucket = digest.readUInt32BE(offset) % this.dimensions;
        const sign = (digest[offset + 4]! & 1) === 0 ? 1 : -1;
        vector[bucket]! += sign;
      }
    }

    return l2Normalize(vector);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map(stemPlural);
}

/**
 * Naive plural stemming so "deals" and "deal" hash to the same bucket.
 * Applied identically at index and query time, so it only ever increases
 * lexical recall. Skips short tokens ("is") and -ss words ("address").
 */
function stemPlural(token: string): string {
  if (token.length >= 4 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}
