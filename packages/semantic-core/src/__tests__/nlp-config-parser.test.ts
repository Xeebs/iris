import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseConfigNL, NlpConfigService } from '../nlp-config-parser.js';

// ─── parseConfigNL unit tests ─────────────────────────────────────────────────

vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    __mockCreate: mockCreate,
  };
});

async function getMockCreate() {
  const mod = await import('openai') as { __mockCreate: ReturnType<typeof vi.fn> };
  return mod.__mockCreate;
}

function makeOpenAiResponse(content: object) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

describe('parseConfigNL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses fiscal calendar statement correctly', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(makeOpenAiResponse({
      configType: 'fiscal_calendar',
      parsedJson: { fiscalYearStartMonth: 2, fiscalYearStartDay: 1 },
      summary: 'Fiscal year starts February 1st',
      confidence: 0.95,
    }));

    const result = await parseConfigNL('Our fiscal year starts in February', 'sk-test');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed.configType).toBe('fiscal_calendar');
    expect(parsed.parsedJson['fiscalYearStartMonth']).toBe(2);
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.summary).toContain('February');
  });

  it('parses metric definition correctly', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(makeOpenAiResponse({
      configType: 'metric_definition',
      parsedJson: { metric: 'ARR', formula: 'MRR * 12' },
      summary: 'ARR defined as MRR × 12',
      confidence: 0.98,
    }));

    const result = await parseConfigNL('ARR is MRR times 12', 'sk-test');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().configType).toBe('metric_definition');
  });

  it('returns err when OpenAI response is empty', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

    const result = await parseConfigNL('some text', 'sk-test');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Empty response');
  });

  it('returns err when response is missing required fields', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockResolvedValue(makeOpenAiResponse({ configType: 'fiscal_calendar' }));

    const result = await parseConfigNL('some text', 'sk-test');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('missing required fields');
  });

  it('returns err when OpenAI throws', async () => {
    const mockCreate = await getMockCreate();
    mockCreate.mockRejectedValue(new Error('API error'));

    const result = await parseConfigNL('some text', 'sk-test');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('API error');
  });

  it('returns err when input is too long', async () => {
    const longText = 'a'.repeat(10_000);
    const result = await parseConfigNL(longText, 'sk-test');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('too long');
  });
});

// ─── NlpConfigService unit tests ──────────────────────────────────────────────

const FAKE_ROW = {
  id: 'cfg-1',
  workspaceId: 'ws-1',
  configType: 'fiscal_calendar' as const,
  inputText: 'Fiscal year starts in February',
  parsedJson: { fiscalYearStartMonth: 2 },
  status: 'pending' as const,
  approvedBy: null,
  approvedAt: null,
  interpretedAt: new Date(),
  createdAt: new Date(),
};

function makeSql(rows: unknown[]) {
  const mockSql = vi.fn();
  const results = [...rows];
  const proxy = new Proxy(mockSql, {
    apply: (_t, _this, args: unknown[]) => {
      const strings = args[0] as string[];
      const s = Array.isArray(strings) ? strings.join('') : '';
      if (!s.includes('SELECT') && !s.includes('INSERT') && !s.includes('UPDATE')) {
        return { strings, values: args.slice(1) };
      }
      return Promise.resolve(results.shift() ?? []);
    },
  });
  return proxy as unknown as Parameters<typeof NlpConfigService>[0];
}

describe('NlpConfigService', () => {
  describe('saveConfig()', () => {
    it('returns ok with the saved record', async () => {
      const sql = makeSql([[FAKE_ROW]]);
      const service = new NlpConfigService(sql);
      const result = await service.saveConfig('ws-1', 'Fiscal year starts in February', {
        configType: 'fiscal_calendar',
        parsedJson: { fiscalYearStartMonth: 2 },
        summary: 'Fiscal year starts February 1st',
        confidence: 0.95,
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().id).toBe('cfg-1');
    });
  });

  describe('listConfigs()', () => {
    it('returns all configs for a workspace', async () => {
      const sql = makeSql([[FAKE_ROW, { ...FAKE_ROW, id: 'cfg-2' }]]);
      const service = new NlpConfigService(sql);
      const result = await service.listConfigs('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });
  });

  describe('approveConfig()', () => {
    it('returns ok with approved record', async () => {
      const approved = { ...FAKE_ROW, status: 'approved' as const, approvedBy: 'user-1' };
      const sql = makeSql([[approved]]);
      const service = new NlpConfigService(sql);
      const result = await service.approveConfig('ws-1', 'cfg-1', 'user-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.status).toBe('approved');
    });

    it('returns ok null when not found', async () => {
      const sql = makeSql([[]]); // empty result
      const service = new NlpConfigService(sql);
      const result = await service.approveConfig('ws-1', 'nonexistent', 'user-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });
});
