import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { detectEntityTypes, getDomainKeywords, clearDetectionCache } from '../query-decomposer.js';

const ALL_TYPES = ['contact', 'company', 'deal', 'issue', 'project', 'page', 'channel', 'user', 'file', 'record'];

beforeEach(() => {
  clearDetectionCache();
  mockCreate.mockReset();
});

// ─── getDomainKeywords ────────────────────────────────────────────────────────

describe('getDomainKeywords', () => {
  it('detects sales domain from revenue/deal keywords', () => {
    const result = getDomainKeywords('What are our biggest deals by revenue this quarter?');
    expect(result.domain).toBe('sales');
    expect(result.keywords).toContain('deals');
    expect(result.keywords).toContain('revenue');
  });

  it('detects engineering domain from sprint/bug keywords', () => {
    const result = getDomainKeywords('How many bugs are in the current sprint?');
    expect(result.domain).toBe('engineering');
    expect(result.keywords).toContain('bugs');
    expect(result.keywords).toContain('sprint');
  });

  it('detects HR domain from employee keywords', () => {
    const result = getDomainKeywords('Show me all employees in the engineering department');
    expect(result.domain).toBe('hr');
  });

  it('detects finance domain from budget keywords', () => {
    const result = getDomainKeywords('What is the Q4 budget for marketing?');
    expect(result.domain).toBe('finance');
    expect(result.keywords).toContain('budget');
  });

  it('returns null domain when query has no domain keywords', () => {
    const result = getDomainKeywords('hello world');
    expect(result.domain).toBeNull();
  });

  it('filters stop words from keywords', () => {
    const result = getDomainKeywords('What are the top deals this week?');
    expect(result.keywords).not.toContain('what');
    expect(result.keywords).not.toContain('the');
    expect(result.keywords).not.toContain('are');
  });

  it('returns empty keywords for empty query', () => {
    const result = getDomainKeywords('');
    expect(result.domain).toBeNull();
    expect(result.keywords).toHaveLength(0);
  });
});

// ─── detectEntityTypes — keyword matching ────────────────────────────────────

describe('detectEntityTypes — keyword matching', () => {
  it('detects "contact" type from contacts keyword', async () => {
    const result = await detectEntityTypes('Show me all contacts from Acme Corp', ['contact', 'deal'], undefined);
    expect(result).toContain('contact');
    expect(result).not.toContain('deal');
  });

  it('detects "deal" type from opportunities synonym', async () => {
    const result = await detectEntityTypes('What opportunities are in the pipeline?', ALL_TYPES, undefined);
    expect(result).toContain('deal');
  });

  it('detects "issue" type from tickets synonym', async () => {
    const result = await detectEntityTypes('List all open tickets for this sprint', ALL_TYPES, undefined);
    expect(result).toContain('issue');
  });

  it('detects "company" type from accounts synonym', async () => {
    const result = await detectEntityTypes('What accounts are expiring this month?', ALL_TYPES, undefined);
    expect(result).toContain('company');
  });

  it('detects "channel" type from slack keyword', async () => {
    const result = await detectEntityTypes('Show me recent slack messages', ALL_TYPES, undefined);
    expect(result).toContain('channel');
  });

  it('detects multiple entity types from one query', async () => {
    const result = await detectEntityTypes(
      'Show contacts and their associated companies',
      ['contact', 'company', 'deal'],
      undefined,
    );
    expect(result).toContain('contact');
    expect(result).toContain('company');
    expect(result).not.toContain('deal');
  });

  it('returns all available types when no keyword matches and no API key', async () => {
    const result = await detectEntityTypes('tell me something interesting', ['contact', 'deal'], undefined);
    expect(result).toEqual(['contact', 'deal']);
  });

  it('returns empty array when availableTypes is empty', async () => {
    const result = await detectEntityTypes('show me contacts', [], undefined);
    expect(result).toHaveLength(0);
  });

  it('only matches types that exist in availableTypes', async () => {
    const result = await detectEntityTypes('show me contacts and issues', ['contact'], undefined);
    expect(result).toContain('contact');
    expect(result).not.toContain('issue');
  });

  it('handles direct type name match in query', async () => {
    const result = await detectEntityTypes('list all project entities', ALL_TYPES, undefined);
    expect(result).toContain('project');
  });
});

// ─── detectEntityTypes — caching ─────────────────────────────────────────────

describe('detectEntityTypes — caching', () => {
  it('returns cached result on second call without re-running logic', async () => {
    const query = 'show me deals';
    const first = await detectEntityTypes(query, ['contact', 'deal'], undefined);
    const second = await detectEntityTypes(query, ['contact', 'deal'], undefined);
    expect(first).toEqual(second);
  });

  it('cache is keyed by both query and available types', async () => {
    const resultA = await detectEntityTypes('show me deals', ['contact', 'deal'], undefined);
    const resultB = await detectEntityTypes('show me deals', ['contact', 'deal', 'company'], undefined);
    expect(resultA).toEqual(['deal']);
    expect(resultB).toEqual(['deal']);
  });

  it('clearDetectionCache() allows fresh detection', async () => {
    await detectEntityTypes('show me deals', ['contact', 'deal'], undefined);
    clearDetectionCache();
    const result = await detectEntityTypes('show me deals', ['contact', 'deal'], undefined);
    expect(result).toContain('deal');
  });
});

// ─── detectEntityTypes — LLM fallback ────────────────────────────────────────

describe('detectEntityTypes — LLM fallback', () => {
  it('calls OpenAI when no keyword matches and API key is provided', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["contact"]' } }],
    });

    // "quarterly performance highlights" has no synonyms for 'contact' or 'deal'
    const result = await detectEntityTypes('quarterly performance highlights', ['contact', 'deal'], 'sk-test');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result).toContain('contact');
  });

  it('does NOT call OpenAI when keyword match succeeds', async () => {
    await detectEntityTypes('show me contacts', ['contact', 'deal'], 'sk-test');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns all types when LLM responds with empty array', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '[]' } }],
    });

    const result = await detectEntityTypes('something vague', ['contact', 'deal'], 'sk-test');
    expect(result).toEqual(['contact', 'deal']);
  });

  it('returns all types when LLM response cannot be parsed', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'I cannot determine this.' } }],
    });

    const result = await detectEntityTypes('something vague', ['contact', 'deal'], 'sk-test');
    expect(result).toEqual(['contact', 'deal']);
  });

  it('filters LLM response to only include valid available types', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '["contact", "unicorn", "deal"]' } }],
    });

    const result = await detectEntityTypes('customer opportunities', ['contact', 'deal'], 'sk-test');
    expect(result).toContain('contact');
    expect(result).toContain('deal');
    expect(result).not.toContain('unicorn');
  });

  it('falls back to all types when OpenAI throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    const result = await detectEntityTypes('something vague', ['contact', 'deal'], 'sk-test');
    expect(result).toEqual(['contact', 'deal']);
  });

  it('does not call OpenAI when no API key is given', async () => {
    await detectEntityTypes('something with no keywords', ['contact', 'deal'], undefined);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
