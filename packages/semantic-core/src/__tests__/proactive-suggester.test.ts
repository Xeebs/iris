import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSuggestions, ProactiveSuggesterService } from '../proactive-suggester.js';
import type { RecentActivity, SuggestedContext } from '../proactive-suggester.js';

// ─── generateSuggestions ──────────────────────────────────────────────────────

describe('generateSuggestions', () => {
  it('returns empty suggestions for no activity', () => {
    const result = generateSuggestions([]);
    expect(result.suggestions).toBeDefined();
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('returns at most maxSuggestions items', () => {
    const activity: RecentActivity[] = Array.from({ length: 10 }, (_, i) => ({
      query: `contact customer deal company issue metric ${i}`,
      timestamp: new Date(),
    }));
    const result = generateSuggestions(activity, undefined, 3);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it('surfaces frequently queried entity types', () => {
    const activity: RecentActivity[] = [
      { query: 'show me my deals', timestamp: new Date() },
      { query: 'top deals this quarter', timestamp: new Date() },
      { query: 'closed deals', timestamp: new Date() },
    ];
    const result = generateSuggestions(activity, undefined, 5);
    const types = result.suggestions.map(s => s.entityType);
    expect(types).toContain('deal');
  });

  it('applies role affinities for sales role', () => {
    const result = generateSuggestions([], 'sales', 5);
    const types = result.suggestions.map(s => s.entityType);
    expect(types.some(t => ['deal', 'contact', 'company'].includes(t))).toBe(true);
  });

  it('applies role affinities for engineering role', () => {
    const result = generateSuggestions([], 'engineering', 5);
    const types = result.suggestions.map(s => s.entityType);
    expect(types.some(t => ['issue', 'document', 'message'].includes(t))).toBe(true);
  });

  it('confidence values are between 0 and 1', () => {
    const activity: RecentActivity[] = [
      { query: 'contact', timestamp: new Date() },
      { query: 'deal', timestamp: new Date() },
    ];
    const result = generateSuggestions(activity, 'sales', 3);
    for (const s of result.suggestions) {
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('orders by confidence descending', () => {
    const activity: RecentActivity[] = Array.from({ length: 5 }, () => ({
      query: 'deal opportunity sale',
      timestamp: new Date(),
    }));
    const result = generateSuggestions(activity, undefined, 5);
    for (let i = 1; i < result.suggestions.length; i++) {
      expect(result.suggestions[i - 1]!.confidence).toBeGreaterThanOrEqual(
        result.suggestions[i]!.confidence,
      );
    }
  });

  it('does not duplicate entity types', () => {
    const activity: RecentActivity[] = [
      { query: 'contact customer', timestamp: new Date() },
      { query: 'contact lead', timestamp: new Date() },
    ];
    const result = generateSuggestions(activity, 'sales', 5);
    const types = result.suggestions.map(s => s.entityType);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it('includes reason string for each suggestion', () => {
    const result = generateSuggestions([{ query: 'deal', timestamp: new Date() }]);
    for (const s of result.suggestions) {
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });
});

// ─── ProactiveSuggesterService ────────────────────────────────────────────────

describe('ProactiveSuggesterService', () => {
  let service: ProactiveSuggesterService;

  const SUGGESTIONS: SuggestedContext[] = [
    { entityType: 'deal', label: 'Deals', reason: 'Frequently queried', confidence: 0.9 },
    { entityType: 'contact', label: 'Contacts', reason: 'Commonly accessed afternoon', confidence: 0.7 },
  ];

  beforeEach(() => {
    const sql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    service = new ProactiveSuggesterService(sql);
  });

  it('logSuggestions returns ok for empty array', async () => {
    const result = await service.logSuggestions('ws-1', 'user-1', []);
    expect(result.isOk()).toBe(true);
  });

  it('logSuggestions returns ok on success', async () => {
    const result = await service.logSuggestions('ws-1', 'user-1', SUGGESTIONS);
    expect(result.isOk()).toBe(true);
  });

  it('logSuggestions returns err on SQL failure', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db error'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new ProactiveSuggesterService(sql);
    const result = await svc.logSuggestions('ws-1', 'user-1', SUGGESTIONS);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db error');
  });

  it('getRecentSuggestions returns parsed rows', async () => {
    const mockRows = [
      {
        id: 'row-1',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        entity_type: 'deal',
        entity_label: 'Deals',
        entity_id: null,
        reason: 'Frequently queried',
        confidence: 0.9,
        suggested_at: new Date(),
      },
    ];
    const sql = vi.fn(() => Promise.resolve(mockRows)) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new ProactiveSuggesterService(sql);
    const result = await svc.getRecentSuggestions('ws-1', 'user-1');
    expect(result.isOk()).toBe(true);
    const items = result._unsafeUnwrap();
    expect(items).toHaveLength(1);
    expect(items[0]!.entityType).toBe('deal');
    expect(items[0]!.confidence).toBe(0.9);
  });

  it('getRecentSuggestions omits entityId when null', async () => {
    const mockRows = [{
      id: 'r1', workspace_id: 'ws-1', user_id: 'u1',
      entity_type: 'contact', entity_label: 'Contacts', entity_id: null,
      reason: 'test', confidence: 0.5, suggested_at: new Date(),
    }];
    const sql = vi.fn(() => Promise.resolve(mockRows)) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new ProactiveSuggesterService(sql);
    const result = await svc.getRecentSuggestions('ws-1', 'u1');
    expect(result.isOk()).toBe(true);
    const item = result._unsafeUnwrap()[0]!;
    expect('entityId' in item).toBe(false);
  });

  it('getRecentSuggestions returns err on SQL failure', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('conn error'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new ProactiveSuggesterService(sql);
    const result = await svc.getRecentSuggestions('ws-1', 'u1');
    expect(result.isErr()).toBe(true);
  });

  it('getCoOccurrencePatterns returns ok', async () => {
    const result = await service.getCoOccurrencePatterns('ws-1');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('getCoOccurrencePatterns returns err on failure', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('err'))) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new ProactiveSuggesterService(sql);
    const result = await svc.getCoOccurrencePatterns('ws-1');
    expect(result.isErr()).toBe(true);
  });
});
