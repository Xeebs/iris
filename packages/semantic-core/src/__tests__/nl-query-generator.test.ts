import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NlQueryGenerator, type LlmClient } from '../nl-query-generator.js';

function makeSql() {
  return vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('NlQueryGenerator', () => {
  let sql: ReturnType<typeof makeSql>;
  let gen: NlQueryGenerator;

  beforeEach(() => {
    sql = makeSql();
    gen = new NlQueryGenerator(sql);
    vi.clearAllMocks();
  });

  describe('classifyQueryIntent', () => {
    it('classifies aggregation questions', async () => {
      const intent = await gen.classifyQueryIntent('how many contacts do we have in total');
      expect(intent.type).toBe('aggregation');
      expect(intent.confidence).toBeGreaterThan(0.7);
    });

    it('classifies metric-lookup questions', async () => {
      const intent = await gen.classifyQueryIntent('what is our MRR this month');
      expect(intent.type).toBe('metric-lookup');
    });

    it('classifies entity-search questions', async () => {
      const intent = await gen.classifyQueryIntent('show all contacts in New York');
      expect(intent.type).toBe('entity-search');
    });

    it('classifies trend-analysis questions', async () => {
      const intent = await gen.classifyQueryIntent('show deal trends over time this quarter');
      expect(intent.type).toBe('trend-analysis');
    });

    it('classifies comparison questions', async () => {
      const intent = await gen.classifyQueryIntent('compare enterprise segment versus SMB segment');
      expect(intent.type).toBe('comparison');
    });

    it('returns confidence between 0 and 1', async () => {
      const intent = await gen.classifyQueryIntent('find open deals');
      expect(intent.confidence).toBeGreaterThan(0);
      expect(intent.confidence).toBeLessThanOrEqual(1);
    });

    it('returns keywords array from the question', async () => {
      const intent = await gen.classifyQueryIntent('find contacts with open deals');
      expect(intent.keywords.length).toBeGreaterThan(0);
    });

    it('uses LLM when confidence is low', async () => {
      const llm: LlmClient = { complete: vi.fn().mockResolvedValue('comparison') };
      const genWithLlm = new NlQueryGenerator(sql, llm);
      const intent = await genWithLlm.classifyQueryIntent('blah blah random nonsense query text');
      expect(llm.complete).toHaveBeenCalled();
      expect(['metric-lookup', 'entity-search', 'trend-analysis', 'comparison', 'aggregation']).toContain(intent.type);
    });

    it('falls back gracefully when LLM throws', async () => {
      const llm: LlmClient = { complete: vi.fn().mockRejectedValue(new Error('LLM error')) };
      const genWithLlm = new NlQueryGenerator(sql, llm);
      await expect(genWithLlm.classifyQueryIntent('random query text here')).resolves.toBeDefined();
    });
  });

  describe('mapEntityKeywordsToTypes', () => {
    it('maps contact keywords', () => {
      const types = gen.mapEntityKeywordsToTypes('show me all contacts');
      expect(types).toContain('contact');
    });

    it('maps deal keywords', () => {
      const types = gen.mapEntityKeywordsToTypes('open deals in pipeline');
      expect(types).toContain('deal');
    });

    it('maps multiple entity types', () => {
      const types = gen.mapEntityKeywordsToTypes('contacts and companies in enterprise tier');
      expect(types).toContain('contact');
      expect(types).toContain('company');
    });

    it('defaults to contact and company when no keywords match', () => {
      const types = gen.mapEntityKeywordsToTypes('random unrelated text here');
      expect(types).toContain('contact');
      expect(types).toContain('company');
    });
  });

  describe('generateQueryPlan', () => {
    it('returns a plan with all required fields', async () => {
      const intent = await gen.classifyQueryIntent('find all contacts');
      const plan = gen.generateQueryPlan(intent);
      expect(plan).toHaveProperty('intentType');
      expect(plan).toHaveProperty('entityTypes');
      expect(plan).toHaveProperty('filters');
      expect(plan).toHaveProperty('aggregations');
      expect(plan).toHaveProperty('limit');
      expect(plan).toHaveProperty('explanation');
    });

    it('adds aggregations for aggregation intent', async () => {
      const intent = await gen.classifyQueryIntent('how many contacts total');
      const plan = gen.generateQueryPlan(intent);
      expect(plan.aggregations.length).toBeGreaterThan(0);
    });

    it('adds time range filter for trend-analysis', async () => {
      const intent = await gen.classifyQueryIntent('deal trends over time');
      const plan = gen.generateQueryPlan(intent);
      expect(plan.filters).toHaveProperty('timeRange');
    });

    it('respects context budget for limit calculation', async () => {
      const intent = await gen.classifyQueryIntent('find contacts');
      const plan = gen.generateQueryPlan(intent, 400);
      expect(plan.limit).toBeLessThanOrEqual(50);
      expect(plan.limit).toBeGreaterThan(0);
    });

    it('explanation is a non-empty string', async () => {
      const intent = await gen.classifyQueryIntent('get metrics');
      const plan = gen.generateQueryPlan(intent);
      expect(typeof plan.explanation).toBe('string');
      expect(plan.explanation.length).toBeGreaterThan(5);
    });
  });

  describe('suggestFollowUpQueries', () => {
    it('returns an array of strings', async () => {
      const intent = await gen.classifyQueryIntent('find contacts');
      const plan = gen.generateQueryPlan(intent);
      const suggestions = gen.suggestFollowUpQueries('find contacts', plan);
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('returns at most 3 suggestions', async () => {
      const intent = await gen.classifyQueryIntent('compare companies');
      const plan = gen.generateQueryPlan(intent);
      const suggestions = gen.suggestFollowUpQueries('compare companies', plan);
      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it('adds deal-specific suggestion when question contains deal', async () => {
      const intent = await gen.classifyQueryIntent('show open deals');
      const plan = gen.generateQueryPlan(intent);
      const suggestions = gen.suggestFollowUpQueries('show open deals', plan);
      const hasDealSuggestion = suggestions.some((s) => s.toLowerCase().includes('deal') || s.toLowerCase().includes('close'));
      expect(hasDealSuggestion).toBe(true);
    });
  });

  describe('processNaturalLanguageQuery', () => {
    it('returns a complete session with all fields', async () => {
      const session = await gen.processNaturalLanguageQuery('find contacts', 'ws-1');
      expect(session.sessionId).toHaveLength(32);
      expect(session.workspaceId).toBe('ws-1');
      expect(session.question).toBe('find contacts');
      expect(session.intent).toHaveProperty('type');
      expect(session.queryPlan).toHaveProperty('intentType');
      expect(Array.isArray(session.followUpQuestions)).toBe(true);
    });

    it('calls sql to persist the session', async () => {
      await gen.processNaturalLanguageQuery('find deals', 'ws-1');
      expect(sql).toHaveBeenCalled();
    });

    it('does not throw when sql fails to persist', async () => {
      const failSql = vi.fn().mockRejectedValue(new Error('DB error')) as unknown as ReturnType<typeof makeSql>;
      const failGen = new NlQueryGenerator(failSql);
      await expect(failGen.processNaturalLanguageQuery('find contacts', 'ws-1')).resolves.toBeDefined();
    });
  });

  describe('recordFeedback', () => {
    it('calls sql with feedback data', async () => {
      await gen.recordFeedback('session-1', true, 'Very helpful');
      expect(sql).toHaveBeenCalled();
    });

    it('accepts feedback without notes', async () => {
      await gen.recordFeedback('session-2', false);
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('getSessionHistory', () => {
    it('returns empty sessions when sql returns no rows', async () => {
      const result = await gen.getSessionHistory('ws-1', 10);
      expect(result.sessions).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('uses cursor when provided', async () => {
      await gen.getSessionHistory('ws-1', 10, 'some-cursor');
      expect(sql).toHaveBeenCalled();
    });
  });
});
