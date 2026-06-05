import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildEmbeddingInput, generateEmbeddings, TOKEN_WARNING_THRESHOLD, EMBEDDING_MODEL } from '../embedding.js';
import type { SemanticEntity } from '@iris/connector-sdk';
import OpenAI from 'openai';

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
});

describe('generateEmbeddings', () => {
  const mockCreate = vi.fn();

  beforeEach(() => {
    vi.mocked(OpenAI).mockImplementation(() => ({
      embeddings: { create: mockCreate },
    }) as unknown as OpenAI);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const results = await generateEmbeddings([]);
    expect(results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls OpenAI once for a small batch', async () => {
    mockCreate.mockResolvedValue(makeEmbeddingResponse([0]));
    const results = await generateEmbeddings([contactEntity], { apiKey: 'test-key' });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]?.entityId).toBe('hubspot:contact:1');
    expect(results[0]?.vector).toHaveLength(1536);
  });

  it('calls OpenAI multiple times for batches > 100', async () => {
    const entities = Array.from({ length: 150 }, (_, i) => ({
      ...contactEntity,
      id: `hubspot:contact:${i}`,
    }));
    mockCreate
      .mockResolvedValueOnce(makeEmbeddingResponse(Array.from({ length: 100 }, (_, i) => i)))
      .mockResolvedValueOnce(makeEmbeddingResponse(Array.from({ length: 50 }, (_, i) => i)));

    const results = await generateEmbeddings(entities, { apiKey: 'test-key' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(150);
  });

  it('throws IndexerError when OpenAI call fails', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));
    await expect(generateEmbeddings([contactEntity], { apiKey: 'test-key' })).rejects.toMatchObject({
      code: 'INDEXER_ERROR',
    });
  });
});
