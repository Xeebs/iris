import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityEnricher } from '../entity-enricher.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const WORKSPACE = 'ws-test';

function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'jira:issue:Q3-ENT-2204',
    type: 'issue',
    label: 'Q3-ENT-2204',
    attributes: { summary: 'Enterprise onboarding bug', priority: 'high', status: 'open' },
    relationships: [],
    lastModified: new Date('2026-01-01'),
    sourceId: 'jira:issue:Q3-ENT-2204',
    ...overrides,
  };
}

function makeSql(rows: unknown[] = []) {
  return (() => Promise.resolve(rows)) as unknown as Parameters<typeof EntityEnricher>[1];
}

function makeRedis(cached: string | null = null) {
  return {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

describe('EntityEnricher.enrichEntity', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns predicted terms from LLM', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["bug", "sprint", "backlog", "Q3"]' } }],
    });
    const enricher = new EntityEnricher('sk-test');
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toContain('bug');
    expect(terms).toContain('sprint');
  });

  it('deduplicates predicted terms', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["bug", "bug", "sprint"]' } }],
    });
    const enricher = new EntityEnricher('sk-test');
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms.filter((t) => t === 'bug')).toHaveLength(1);
  });

  it('returns empty array when LLM returns empty', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] });
    const enricher = new EntityEnricher('sk-test');
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toEqual([]);
  });

  it('returns empty array when LLM throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    const enricher = new EntityEnricher('sk-test');
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toEqual([]);
  });

  it('filters out terms with frequency_ratio > 0.7', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["common", "useful"]' } }],
    });
    const sql = makeSql([{ attr_key: 'common', frequency_ratio: 0.8 }]);
    const enricher = new EntityEnricher('sk-test', sql);
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).not.toContain('common');
    expect(terms).toContain('useful');
  });

  it('keeps terms with frequency_ratio <= 0.7', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["borderline"]' } }],
    });
    const sql = makeSql([{ attr_key: 'borderline', frequency_ratio: 0.7 }]);
    const enricher = new EntityEnricher('sk-test', sql);
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toContain('borderline');
  });

  it('keeps terms not in frequency table (assume acceptable)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["newterm"]' } }],
    });
    const sql = makeSql([]); // no rows = term not in table
    const enricher = new EntityEnricher('sk-test', sql);
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toContain('newterm');
  });

  it('returns unfiltered terms when SQL fails', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["term1"]' } }],
    });
    const sql = (() => Promise.reject(new Error('DB error'))) as unknown as Parameters<typeof EntityEnricher>[1];
    const enricher = new EntityEnricher('sk-test', sql);
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms).toContain('term1');
  });

  it('returns cached terms without calling LLM', async () => {
    const redis = makeRedis('["cached-term"]');
    const enricher = new EntityEnricher('sk-test', undefined, redis);
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(terms).toContain('cached-term');
  });

  it('stores enrichment result in Redis after LLM call', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["new-term"]' } }],
    });
    const redis = makeRedis(null);
    const enricher = new EntityEnricher('sk-test', undefined, redis);
    await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^iris:enrich:/),
      '["new-term"]',
      'EX',
      7 * 24 * 60 * 60,
    );
  });

  it('same entity always generates same cache key (content hash)', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '["t1"]' } }] });
    const redis = makeRedis(null);
    const enricher = new EntityEnricher('sk-test', undefined, redis);
    const entity = makeEntity();
    await enricher.enrichEntity(entity, WORKSPACE);
    await enricher.enrichEntity(entity, WORKSPACE);
    // Second call should hit cache (Redis.get returns null mock — so LLM called twice in test,
    // but the key structure should be consistent)
    const [firstKey] = redis.set.mock.calls[0] as [string, ...unknown[]];
    const [secondKey] = redis.set.mock.calls[1] as [string, ...unknown[]];
    expect(firstKey).toBe(secondKey);
  });

  it('limits predicted terms to 10', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '["a","b","c","d","e","f","g","h","i","j","k","l"]',
        },
      }],
    });
    const enricher = new EntityEnricher('sk-test');
    const terms = await enricher.enrichEntity(makeEntity(), WORKSPACE);
    expect(terms.length).toBeLessThanOrEqual(10);
  });
});
