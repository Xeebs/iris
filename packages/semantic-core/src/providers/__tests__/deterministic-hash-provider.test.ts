import { describe, it, expect } from 'vitest';

import { DeterministicHashProvider } from '../deterministic-hash-provider.js';
import { createEmbeddingProvider } from '../../embedding-provider.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized
}

describe('DeterministicHashProvider', () => {
  describe('getEmbedding', () => {
    it('produces a 1536-dimensional vector by default', async () => {
      const provider = new DeterministicHashProvider();
      const vector = await provider.getEmbedding('deal: Acme renewal; stage: negotiation');
      expect(vector).toHaveLength(1536);
      expect(provider.getModelDimensions()).toBe(1536);
    });

    it('returns an identical vector for identical input across calls', async () => {
      const provider = new DeterministicHashProvider();
      const a = await provider.getEmbedding('contact: Jane Doe; company: Acme');
      const b = await provider.getEmbedding('contact: Jane Doe; company: Acme');
      expect(a).toEqual(b);
    });

    it('returns an identical vector across separate instances with the same seed', async () => {
      const a = await new DeterministicHashProvider('seed-1').getEmbedding('open deals total value');
      const b = await new DeterministicHashProvider('seed-1').getEmbedding('open deals total value');
      expect(a).toEqual(b);
    });

    it('produces different vectors for different seeds', async () => {
      const a = await new DeterministicHashProvider('seed-1').getEmbedding('open deals');
      const b = await new DeterministicHashProvider('seed-2').getEmbedding('open deals');
      expect(a).not.toEqual(b);
    });

    it('is L2-normalized', async () => {
      const vector = await new DeterministicHashProvider().getEmbedding('deal stage negotiation');
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1, 6);
    });

    it('ranks token-overlapping text above unrelated text by cosine similarity', async () => {
      const provider = new DeterministicHashProvider();
      const query = await provider.getEmbedding('deals in the negotiation stage');
      const related = await provider.getEmbedding('deal: Acme renewal; stage: negotiation; amount: 50000');
      const unrelated = await provider.getEmbedding('contact: Jane Doe; email hidden; city: Berlin');
      expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
    });

    it('handles empty input without NaN values', async () => {
      const vector = await new DeterministicHashProvider().getEmbedding('');
      expect(vector).toHaveLength(1536);
      expect(vector.every((v) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('batchEmbeddings', () => {
    it('returns one vector per input in order', async () => {
      const provider = new DeterministicHashProvider();
      const vectors = await provider.batchEmbeddings(['alpha beta', 'gamma delta']);
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toEqual(await provider.getEmbedding('alpha beta'));
      expect(vectors[1]).toEqual(await provider.getEmbedding('gamma delta'));
    });

    it('returns an empty array for empty input', async () => {
      const vectors = await new DeterministicHashProvider().batchEmbeddings([]);
      expect(vectors).toEqual([]);
    });
  });

  describe('plural stemming', () => {
    it('embeds singular and plural forms to the same vector', async () => {
      const provider = new DeterministicHashProvider();
      expect(await provider.getEmbedding('deals')).toEqual(await provider.getEmbedding('deal'));
      expect(await provider.getEmbedding('contacts')).toEqual(await provider.getEmbedding('contact'));
    });

    it('does not stem short tokens or -ss words', async () => {
      const provider = new DeterministicHashProvider();
      expect(await provider.getEmbedding('is')).not.toEqual(await provider.getEmbedding('i'));
      expect(await provider.getEmbedding('address')).not.toEqual(await provider.getEmbedding('addres'));
    });
  });

  describe('factory integration', () => {
    it('createEmbeddingProvider returns the hash provider for hash-deterministic', () => {
      const provider = createEmbeddingProvider({ provider: 'hash-deterministic' });
      expect(provider.getModelId()).toBe('hash-deterministic-1536');
      expect(provider.getModelDimensions()).toBe(1536);
    });
  });
});
