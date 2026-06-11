import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildEmbeddingInput, generateEmbeddings, TOKEN_WARNING_THRESHOLD, EMBEDDING_MODEL } from '../embedding.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import { AzureOpenAI } from 'openai';

vi.mock('openai');

const contactEntity: SemanticEntity = {
  id: 'hubspot:contact:1',
  type: 'contact',
  label: 'Alice Smith',
  attributes: {
    company: 'Acme Corp',
    stage: 'lead',
    leadStatus: 'IN_PROGRESS',
    email: 'alice@acme.com',
    phone: '+1-555-0101',
  },
  relationships: [],
  lastModified: new Date('2026-01-01'),
  sourceId: 'hubspot:contact:1',
};

const makeEmbeddingResponse = (indices: number[], dims = 1536) => ({
  data: indices.map((index) => ({
    index,
    embedding: Array.from({ length: dims }, () => Math.random()),
  })),
  model: EMBEDDING_MODEL,
  usage: { prompt_tokens: 20, total_tokens: 20 },
});

describe('buildEmbeddingInput', () => {
  it('builds type:label format', () => {
    const input = buildEmbeddingInput(contactEntity);
    expect(input).toMatch(/^contact: Alice Smith/);
  });

  it('includes non-null attributes', () => {
    const input = buildEmbeddingInput(contactEntity);
    expect(input).toContain('company: Acme Corp');
    expect(input).toContain('stage: lead');
  });

  it('excludes null attributes', () => {
    const entity: SemanticEntity = {
      ...contactEntity,
      attributes: { company: null, stage: 'lead' },
    };
    const input = buildEmbeddingInput(entity);
    expect(input).not.toContain('company');
    expect(input).toContain('stage: lead');
  });

  it('excludes PII fields when specified', () => {
    const input = buildEmbeddingInput(contactEntity, new Set(['email', 'phone']));
    expect(input).not.toContain('alice@acme.com');
    expect(input).not.toContain('+1-555-0101');
    expect(input).toContain('company: Acme Corp');
  });

  it('truncates and warns for very long inputs', () => {
    const longAttr = 'x'.repeat(TOKEN_WARNING_THRESHOLD * 5);
    const entity: SemanticEntity = {
      ...contactEntity,
      attributes: { description: longAttr },
    };
    const input = buildEmbeddingInput(entity);
    expect(input.length).toBeLessThanOrEqual(TOKEN_WARNING_THRESHOLD * 4 + 10);
  });

  it('formats array values as comma-separated strings', () => {
    const entity: SemanticEntity = {
      ...contactEntity,
      attributes: { tags: ['product', 'planning'] },
    };
    const input = buildEmbeddingInput(entity);
    expect(input).toContain('tags: product, planning');
  });

  it('omits non-discriminative attributes when isDiscriminativeAttr returns false', () => {
    const filter = (entityType: string, key: string, _value: string) =>
      !(entityType === 'contact' && key === 'stage');
    const input = buildEmbeddingInput(contactEntity, new Set(), filter);
    expect(input).not.toContain('stage: lead');
    expect(input).toContain('company: Acme Corp');
  });

  it('keeps all attributes when isDiscriminativeAttr returns true for all', () => {
    const filter = () => true;
    const input = buildEmbeddingInput(contactEntity, new Set(), filter);
    expect(input).toContain('stage: lead');
    expect(input).toContain('company: Acme Corp');
  });

  it('passes correct (entityType, key, value) to isDiscriminativeAttr predicate', () => {
    const calls: Array<[string, string, string]> = [];
    const filter = (t: string, k: string, v: string) => { calls.push([t, k, v]); return true; };
    buildEmbeddingInput(contactEntity, new Set(), filter);
    expect(calls.some(([t, k]) => t === 'contact' && k === 'company')).toBe(true);
    expect(calls.some(([, k, v]) => k === 'stage' && v === 'lead')).toBe(true);
  });
});

describe('generateEmbeddings', () => {
  const mockCreate = vi.fn();

  beforeEach(() => {
    // Clear EMBEDDING_PROVIDER so tests use the Azure path (which IS mocked)
    vi.stubEnv('EMBEDDING_PROVIDER', '');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://test.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2023-05-15');
    vi.stubEnv('AZURE_OPENAI_SMALL_DEPLOYMENT', 'text-embedding-3-small');
    vi.stubEnv('AZURE_OPENAI_LARGE_DEPLOYMENT', 'text-embedding-3-large');

    vi.mocked(AzureOpenAI).mockImplementation(() => ({
      embeddings: { create: mockCreate },
    }) as unknown as AzureOpenAI);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const results = await generateEmbeddings([]);
    expect(results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Azure OpenAI once for a small batch', async () => {
    mockCreate.mockResolvedValue(makeEmbeddingResponse([0]));
    const results = await generateEmbeddings([contactEntity]);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]?.entityId).toBe('hubspot:contact:1');
    expect(results[0]?.vector).toHaveLength(1536);
  });

  it('calls Azure OpenAI multiple times for batches > 100', async () => {
    const entities = Array.from({ length: 150 }, (_, i) => ({
      ...contactEntity,
      id: `hubspot:contact:${i}`,
    }));
    mockCreate
      .mockResolvedValueOnce(makeEmbeddingResponse(Array.from({ length: 100 }, (_, i) => i)))
      .mockResolvedValueOnce(makeEmbeddingResponse(Array.from({ length: 50 }, (_, i) => i)));

    const results = await generateEmbeddings(entities);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(150);
  });

  it('throws IndexerError when Azure OpenAI call fails', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));
    await expect(generateEmbeddings([contactEntity])).rejects.toMatchObject({
      code: 'INDEXER_ERROR',
    });
  });

  it('throws IndexerError when Azure env vars are missing', async () => {
    vi.unstubAllEnvs();
    await expect(generateEmbeddings([contactEntity])).rejects.toMatchObject({
      code: 'INDEXER_ERROR',
    });
  });
});
