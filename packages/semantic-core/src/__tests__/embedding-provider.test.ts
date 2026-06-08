import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createEmbeddingProvider, createDefaultProvider } from '../embedding-provider.js';
import { OpenAIProvider } from '../providers/openai-provider.js';
import { AzureOpenAIProvider } from '../providers/azure-openai-provider.js';
import { OllamaProvider } from '../providers/ollama-provider.js';
import { CohereProvider } from '../providers/cohere-provider.js';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: { total_tokens: 10 },
      }),
    },
  })),
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [0.4, 0.5, 0.6] }],
        usage: { total_tokens: 12 },
      }),
    },
  })),
}));

global.fetch = vi.fn();

describe('createEmbeddingProvider', () => {
  it('creates an OpenAIProvider for provider=openai', () => {
    const p = createEmbeddingProvider({ provider: 'openai', apiKey: 'k' });
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it('creates an AzureOpenAIProvider for provider=azure', () => {
    const p = createEmbeddingProvider({
      provider: 'azure',
      apiKey: 'k',
      endpoint: 'https://example.openai.azure.com',
      deployment: 'text-embedding-3-small',
    });
    expect(p).toBeInstanceOf(AzureOpenAIProvider);
  });

  it('creates an OllamaProvider for provider=ollama', () => {
    const p = createEmbeddingProvider({ provider: 'ollama' });
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it('creates a CohereProvider for provider=cohere', () => {
    const p = createEmbeddingProvider({ provider: 'cohere', apiKey: 'k' });
    expect(p).toBeInstanceOf(CohereProvider);
  });

  it('throws for unknown provider', () => {
    expect(() =>
      // @ts-expect-error intentional unknown provider
      createEmbeddingProvider({ provider: 'unknown' }),
    ).toThrow('Unknown embedding provider');
  });
});

describe('createDefaultProvider', () => {
  beforeEach(() => {
    delete process.env['EMBEDDING_PROVIDER'];
    delete process.env['OPENAI_API_KEY'];
  });

  it('defaults to openai when EMBEDDING_PROVIDER is unset', () => {
    const p = createDefaultProvider();
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it('reads EMBEDDING_PROVIDER from env', () => {
    process.env['EMBEDDING_PROVIDER'] = 'ollama';
    const p = createDefaultProvider();
    expect(p).toBeInstanceOf(OllamaProvider);
    delete process.env['EMBEDDING_PROVIDER'];
  });
});

describe('OpenAIProvider', () => {
  it('returns correct model id and dimensions for text-embedding-3-small', () => {
    const p = new OpenAIProvider('k', 'text-embedding-3-small');
    expect(p.getModelId()).toBe('text-embedding-3-small');
    expect(p.getModelDimensions()).toBe(1536);
  });

  it('returns correct dimensions for text-embedding-3-large', () => {
    const p = new OpenAIProvider('k', 'text-embedding-3-large');
    expect(p.getModelDimensions()).toBe(3072);
  });

  it('returns 1536 for unknown model', () => {
    const p = new OpenAIProvider('k', 'some-future-model');
    expect(p.getModelDimensions()).toBe(1536);
  });

  it('delegates getEmbedding to batchEmbeddings[0]', async () => {
    const p = new OpenAIProvider('k', 'text-embedding-3-small');
    const result = await p.getEmbedding('test text');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty input', async () => {
    const p = new OpenAIProvider('k', 'text-embedding-3-small');
    const result = await p.batchEmbeddings([]);
    expect(result).toEqual([]);
  });

  it('throws IndexerError when API call fails', async () => {
    const { default: OpenAI } = await import('openai');
    vi.mocked(OpenAI).mockImplementationOnce(() => ({
      embeddings: {
        create: vi.fn().mockRejectedValue(new Error('network error')),
      },
    }) as never);
    const p = new OpenAIProvider('k', 'text-embedding-3-small');
    await expect(p.batchEmbeddings(['text'])).rejects.toThrow('OpenAI embedding failed');
  });
});

describe('AzureOpenAIProvider', () => {
  it('throws when endpoint or apiKey is missing', () => {
    expect(() => new AzureOpenAIProvider({ endpoint: '', apiKey: '', apiVersion: '', deployment: 'd' }))
      .toThrow('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required');
  });

  it('returns correct model id and dimensions', () => {
    const p = new AzureOpenAIProvider({
      endpoint: 'https://ep.openai.azure.com',
      apiKey: 'k',
      apiVersion: '2023-05-15',
      deployment: 'text-embedding-3-small',
    });
    expect(p.getModelId()).toBe('text-embedding-3-small');
    expect(p.getModelDimensions()).toBe(1536);
  });

  it('returns empty array for empty input', async () => {
    const p = new AzureOpenAIProvider({
      endpoint: 'https://ep.openai.azure.com',
      apiKey: 'k',
      apiVersion: '2023-05-15',
      deployment: 'text-embedding-3-small',
    });
    const result = await p.batchEmbeddings([]);
    expect(result).toEqual([]);
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => { vi.mocked(fetch).mockReset(); });

  it('returns correct model id and dimensions for nomic-embed-text', () => {
    const p = new OllamaProvider('http://localhost:11434', 'nomic-embed-text');
    expect(p.getModelId()).toBe('nomic-embed-text');
    expect(p.getModelDimensions()).toBe(768);
  });

  it('returns 768 for unknown model', () => {
    const p = new OllamaProvider('http://localhost:11434', 'unknown-model');
    expect(p.getModelDimensions()).toBe(768);
  });

  it('calls /api/embeddings and returns vector', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] }),
    } as Response);

    const p = new OllamaProvider('http://localhost:11434', 'nomic-embed-text');
    const result = await p.getEmbedding('hello');
    expect(result).toEqual([0.1, 0.2]);
  });

  it('throws IndexerError on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const p = new OllamaProvider('http://localhost:11434', 'nomic-embed-text');
    await expect(p.getEmbedding('hello')).rejects.toThrow('Ollama embedding request failed with status 500');
  });

  it('throws IndexerError on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('connection refused'));
    const p = new OllamaProvider('http://localhost:11434', 'nomic-embed-text');
    await expect(p.getEmbedding('hello')).rejects.toThrow('Ollama embedding request failed');
  });

  it('returns empty array for empty input', async () => {
    const p = new OllamaProvider('http://localhost:11434', 'nomic-embed-text');
    const result = await p.batchEmbeddings([]);
    expect(result).toEqual([]);
  });
});

describe('CohereProvider', () => {
  beforeEach(() => { vi.mocked(fetch).mockReset(); });

  it('throws when apiKey is empty', () => {
    expect(() => new CohereProvider('', 'embed-english-v3.0')).toThrow('COHERE_API_KEY is required');
  });

  it('returns correct model id and dimensions', () => {
    const p = new CohereProvider('key', 'embed-english-v3.0');
    expect(p.getModelId()).toBe('embed-english-v3.0');
    expect(p.getModelDimensions()).toBe(1024);
  });

  it('returns 384 for embed-english-light-v3.0', () => {
    const p = new CohereProvider('key', 'embed-english-light-v3.0');
    expect(p.getModelDimensions()).toBe(384);
  });

  it('calls Cohere API and returns embeddings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
    } as Response);

    const p = new CohereProvider('key', 'embed-english-v3.0');
    const result = await p.batchEmbeddings(['a', 'b']);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('throws IndexerError on non-ok Cohere response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    const p = new CohereProvider('bad-key', 'embed-english-v3.0');
    await expect(p.batchEmbeddings(['text'])).rejects.toThrow('Cohere embedding failed with status 401');
  });

  it('throws IndexerError on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('DNS failure'));
    const p = new CohereProvider('key', 'embed-english-v3.0');
    await expect(p.getEmbedding('text')).rejects.toThrow('Cohere embedding request failed');
  });

  it('returns empty array for empty input', async () => {
    const p = new CohereProvider('key', 'embed-english-v3.0');
    const result = await p.batchEmbeddings([]);
    expect(result).toEqual([]);
  });

  it('delegates getEmbedding to batchEmbeddings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.5, 0.6]] }),
    } as Response);
    const p = new CohereProvider('key', 'embed-english-v3.0');
    const result = await p.getEmbedding('hello');
    expect(result).toEqual([0.5, 0.6]);
  });
});
