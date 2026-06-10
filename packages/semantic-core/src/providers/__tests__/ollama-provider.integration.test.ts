import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaProvider } from '../ollama-provider.js';

const OLLAMA_ENDPOINT = process.env['OLLAMA_ENDPOINT'] ?? 'http://localhost:11434';
const MODEL = 'nomic-embed-text';

// Check reachability once before all tests; skip the whole suite if Ollama is down.
let ollamaReachable = false;
beforeAll(async () => {
  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }
  if (!ollamaReachable) {
    console.log(`[skip] Ollama not reachable at ${OLLAMA_ENDPOINT} — skipping integration tests`);
  }
});

describe.skipIf(!ollamaReachable || true)('OllamaProvider integration (requires local Ollama)', () => {
  // Re-evaluate skip at test runtime (the beforeAll flag is set by then)
  it.todo('placeholder — actual tests run conditionally below');
});

describe('OllamaProvider.integration', () => {
  it('returns 768-dim vectors for nomic-embed-text', async () => {
    if (!ollamaReachable) {
      console.log('[skip] Ollama not reachable');
      return;
    }

    const provider = new OllamaProvider(OLLAMA_ENDPOINT, MODEL);
    expect(provider.getModelDimensions()).toBe(768);

    const vector = await provider.getEmbedding('hello world');
    expect(vector).toHaveLength(768);
    expect(vector.every((v) => typeof v === 'number' && isFinite(v))).toBe(true);
  });

  it('batch-embeds 5 texts and returns 768-dim vectors for each', async () => {
    if (!ollamaReachable) {
      console.log('[skip] Ollama not reachable');
      return;
    }

    const provider = new OllamaProvider(OLLAMA_ENDPOINT, MODEL);
    const texts = [
      'contact: Alice Smith. company: Acme Corp; stage: lead',
      'company: Acme Corp. industry: Technology; employees: 120',
      'deal: Q1 2026 Expansion. amount: 45000; stage: negotiation',
      'contact: Bob Chen. company: Initech; stage: customer',
      'deal: Annual Renewal. amount: 12000; stage: closed_won',
    ];

    const vectors = await provider.batchEmbeddings(texts);
    expect(vectors).toHaveLength(5);
    for (const v of vectors) {
      expect(v).toHaveLength(768);
      expect(v.every((x) => typeof x === 'number' && isFinite(x))).toBe(true);
    }
  });

  it('returns distinct vectors for different inputs', async () => {
    if (!ollamaReachable) {
      console.log('[skip] Ollama not reachable');
      return;
    }

    const provider = new OllamaProvider(OLLAMA_ENDPOINT, MODEL);
    const [v1, v2] = await provider.batchEmbeddings(['Alice Smith CEO', 'quarterly revenue report']);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();

    // Cosine similarity of very different texts should be well below 0.9
    const dot = v1!.reduce((sum, a, i) => sum + a * v2![i]!, 0);
    expect(dot).toBeLessThan(0.9);
  });

  it('returns same vector for identical input (deterministic)', async () => {
    if (!ollamaReachable) {
      console.log('[skip] Ollama not reachable');
      return;
    }

    const provider = new OllamaProvider(OLLAMA_ENDPOINT, MODEL);
    const text = 'contact: Alice Smith. company: Acme Corp';
    const [v1, v2] = await Promise.all([provider.getEmbedding(text), provider.getEmbedding(text)]);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    // Same text → same vector (model is deterministic at temp=0 for embeddings)
    const maxDiff = Math.max(...v1!.map((a, i) => Math.abs(a - v2![i]!)));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('returns empty array for empty batch', async () => {
    const provider = new OllamaProvider(OLLAMA_ENDPOINT, MODEL);
    const result = await provider.batchEmbeddings([]);
    expect(result).toEqual([]);
  });
});
