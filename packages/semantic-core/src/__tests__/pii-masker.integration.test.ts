import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PiiConfigService } from '../pii-masker.js';
import type { PiiStrategy } from '../pii-masker.js';

// ─── SQL mock ─────────────────────────────────────────────────────────────────

function makeSqlMock(responses: Map<string, unknown[]>) {
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join('?');
    for (const [key, value] of responses.entries()) {
      if (query.includes(key)) return Promise.resolve(value);
    }
    return Promise.resolve([{ count: 1 }]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  return sql;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PiiConfigService', () => {
  let service: PiiConfigService;

  beforeEach(() => {
    const sql = makeSqlMock(new Map([
      ['pii_configs WHERE workspace_id', [{
        id: 'cfg-1',
        workspace_id: 'ws1',
        enable_auto_detection: true,
        default_strategy: 'redact' as PiiStrategy,
        tokenization_key: 'tok-key-abc',
      }]],
      ['pii_field_configs WHERE workspace_id', [{
        id: 'fc-1',
        workspace_id: 'ws1',
        field_name: 'email',
        strategy: 'hash' as PiiStrategy,
        custom_pattern: null,
      }]],
    ]));
    service = new PiiConfigService(sql);
  });

  it('loads workspace config with field overrides', async () => {
    const result = await service.getConfig('ws1');
    expect(result.isOk()).toBe(true);
    const config = result._unsafeUnwrap();
    expect(config).not.toBeNull();
    expect(config!.workspaceId).toBe('ws1');
    expect(config!.enableAutoDetection).toBe(true);
    expect(config!.defaultStrategy).toBe('redact');
    expect(config!.fieldConfigs).toHaveLength(1);
    expect(config!.fieldConfigs[0]!.fieldName).toBe('email');
    expect(config!.fieldConfigs[0]!.strategy).toBe('hash');
  });

  it('returns null when no config exists', async () => {
    const emptySql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    const emptyService = new PiiConfigService(emptySql);
    const result = await emptyService.getConfig('ws-unknown');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it('returns err on SQL failure', async () => {
    const brokenSql = vi.fn(() => Promise.reject(new Error('db error'))) as unknown as ReturnType<typeof import('postgres').default>;
    const brokenService = new PiiConfigService(brokenSql);
    const result = await brokenService.getConfig('ws1');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('db error');
  });

  it('upsertConfig calls SQL without throwing', async () => {
    const calls: unknown[] = [];
    const trackSql = vi.fn((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(trackSql);
    const result = await svc.upsertConfig('ws1', true, 'redact');
    expect(result.isOk()).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('upsertFieldConfig calls SQL without throwing', async () => {
    const trackSql = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(trackSql);
    const result = await svc.upsertFieldConfig('ws1', 'ssn', 'hash');
    expect(result.isOk()).toBe(true);
  });

  it('deleteFieldConfig returns true when row deleted', async () => {
    const trackSql = vi.fn(() => Promise.resolve([{ count: 1 }])) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new PiiConfigService(trackSql);
    const result = await svc.deleteFieldConfig('ws1', 'email');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });
});
