import { describe, it, expect, vi } from 'vitest';
import { BenchmarkingService } from '../benchmarking.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const WORKSPACE = 'ws-bench';

/** Fragment-aware sql mock: if the SQL doesn't look like a DML/SELECT, return inert. */
function makeSql(resultQueue: unknown[][]) {
  const queue = [...resultQueue];
  return new Proxy(
    function sql(strings: TemplateStringsArray) {
      const joined = strings.join('');
      const isDml =
        joined.includes('SELECT') ||
        joined.includes('INSERT') ||
        joined.includes('UPDATE') ||
        joined.includes('DELETE') ||
        joined.includes('FROM');
      if (!isDml) return { strings };
      const next = queue.shift();
      if (next === undefined) throw new Error('makeSql: queue empty');
      return Promise.resolve(Object.assign(next, { count: (next as unknown[]).length }));
    },
    { apply: (t, _, a) => (t as Function)(...a) },
  ) as unknown as Parameters<typeof BenchmarkingService>[0];
}

describe('BenchmarkingService.collectMetrics', () => {
  it('collects and persists metrics', async () => {
    const sql = makeSql([
      [{ count: '42' }],
      [{ count: '100', avg_tokens: '1200.5' }],
      [{ ratio: '0.35' }],
      [{ rate: '0.72' }],
      [],
    ]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.collectMetrics(WORKSPACE);
    expect(result.isOk()).toBe(true);
    const m = result._unsafeUnwrap();
    expect(m.entityCount).toBe(42);
    expect(m.queryCount).toBe(100);
    expect(m.avgContextSizeTokens).toBeCloseTo(1200.5);
    expect(m.tokenSavingsRatio).toBeCloseTo(0.35);
    expect(m.cacheHitRate).toBeCloseTo(0.72);
  });

  it('clamps tokenSavingsRatio to [0,1]', async () => {
    const sql = makeSql([
      [{ count: '0' }],
      [{ count: '0', avg_tokens: '0' }],
      [{ ratio: '1.5' }],
      [{ rate: '0' }],
      [],
    ]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.collectMetrics(WORKSPACE);
    expect(result._unsafeUnwrap().tokenSavingsRatio).toBe(1);
  });

  it('returns err on SQL failure', async () => {
    const sql = new Proxy(
      function () { return Promise.reject(new Error('DB down')); },
      { apply: (t, _, a) => (t as Function)(...a) },
    ) as unknown as Parameters<typeof BenchmarkingService>[0];
    const svc = new BenchmarkingService(sql);
    const result = await svc.collectMetrics(WORKSPACE);
    expect(result.isErr()).toBe(true);
  });
});

describe('BenchmarkingService.getSettings', () => {
  it('returns defaults when no row exists', async () => {
    const sql = makeSql([[]]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.getSettings(WORKSPACE);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().benchmarkingEnabled).toBe(false);
    expect(result._unsafeUnwrap().industry).toBeNull();
  });

  it('returns existing settings', async () => {
    const sql = makeSql([[{
      workspace_id: WORKSPACE,
      benchmarking_enabled: true,
      industry: 'saas',
      company_size: 'smb',
    }]]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.getSettings(WORKSPACE);
    expect(result._unsafeUnwrap().benchmarkingEnabled).toBe(true);
    expect(result._unsafeUnwrap().industry).toBe('saas');
    expect(result._unsafeUnwrap().companySize).toBe('smb');
  });
});

describe('BenchmarkingService.updateSettings', () => {
  it('upserts and returns updated settings', async () => {
    const sql = makeSql([[{
      workspace_id: WORKSPACE,
      benchmarking_enabled: true,
      industry: 'fintech',
      company_size: 'midmarket',
    }]]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.updateSettings(WORKSPACE, {
      benchmarkingEnabled: true,
      industry: 'fintech',
      companySize: 'midmarket',
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().industry).toBe('fintech');
  });

  it('returns err on SQL failure', async () => {
    const sql = new Proxy(
      function () { return Promise.reject(new Error('timeout')); },
      { apply: (t, _, a) => (t as Function)(...a) },
    ) as unknown as Parameters<typeof BenchmarkingService>[0];
    const svc = new BenchmarkingService(sql);
    const result = await svc.updateSettings(WORKSPACE, { benchmarkingEnabled: false });
    expect(result.isErr()).toBe(true);
  });
});

describe('BenchmarkingService.getPeerBenchmarks', () => {
  const SNAPSHOT = {
    entity_count: '100',
    query_count: '200',
    avg_context_size_tokens: '1500',
    token_savings_ratio: '0.6',
    cache_hit_rate: '0.75',
    snapshotted_at: new Date(),
  };

  const PEERS = [
    { token_savings_ratio: '0.3', cache_hit_rate: '0.5', entity_count: '50' },
    { token_savings_ratio: '0.5', cache_hit_rate: '0.65', entity_count: '80' },
    { token_savings_ratio: '0.7', cache_hit_rate: '0.8', entity_count: '120' },
    { token_savings_ratio: '0.55', cache_hit_rate: '0.7', entity_count: '90' },
  ];

  it('returns report with peer comparisons', async () => {
    const sql = makeSql([[SNAPSHOT], PEERS]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.getPeerBenchmarks(WORKSPACE);
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report.peerCount).toBe(4);
    expect(report.peerComparisons.length).toBe(3);
    const savings = report.peerComparisons.find((c) => c.metric === 'tokenSavingsRatio');
    expect(savings).toBeTruthy();
    expect(savings!.percentileRank).toBeGreaterThanOrEqual(0);
    expect(savings!.percentileRank).toBeLessThanOrEqual(100);
  });

  it('returns 422-equivalent error when no snapshot', async () => {
    const sql = makeSql([[]]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.getPeerBenchmarks(WORKSPACE);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('No snapshot');
  });

  it('returns empty comparisons with no peers', async () => {
    const sql = makeSql([[SNAPSHOT], []]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.getPeerBenchmarks(WORKSPACE);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().peerComparisons).toHaveLength(0);
    expect(result._unsafeUnwrap().peerCount).toBe(0);
  });
});

describe('BenchmarkingService.exportMetrics', () => {
  it('exports anonymised metrics', async () => {
    const sql = makeSql([
      [{ entity_count: '50', query_count: '100', token_savings_ratio: '0.5', cache_hit_rate: '0.6' }],
      [],
    ]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.exportMetrics(WORKSPACE, 'saas', 'smb');
    expect(result.isOk()).toBe(true);
  });

  it('returns err when no snapshot exists', async () => {
    const sql = makeSql([[]]);
    const svc = new BenchmarkingService(sql);
    const result = await svc.exportMetrics(WORKSPACE, 'saas', 'smb');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('No snapshot');
  });
});
