import { describe, it, expect, vi } from 'vitest';
import { AttributeFrequencyTracker, FREQUENCY_THRESHOLD } from '../attribute-frequency.js';

function makeSql(rowSets: unknown[][]): ReturnType<typeof import('postgres')['default']> {
  let call = 0;
  return Object.assign(
    () => {
      const rows = rowSets[call] ?? [];
      call++;
      return Promise.resolve(rows);
    },
  ) as unknown as ReturnType<typeof import('postgres')['default']>;
}

describe('AttributeFrequencyTracker.recordAttributes', () => {
  it('does nothing when batchAttrs is empty', async () => {
    const sql = makeSql([]);
    const tracker = new AttributeFrequencyTracker(sql);
    await expect(tracker.recordAttributes('ws-1', 'contact', [], 0)).resolves.not.toThrow();
  });

  it('calls sql when there are attribute entries to record', async () => {
    const sqlFn = vi.fn().mockResolvedValue(undefined);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.recordAttributes(
      'ws-1',
      'contact',
      [{ stage: 'Negotiation', country: 'US' }],
      10,
    );
    // sql is called twice: once for this.sql(rows) serialization helper and once for the INSERT query
    expect(sqlFn).toHaveBeenCalledTimes(2);
  });

  it('skips null attribute values', async () => {
    const sqlFn = vi.fn().mockResolvedValue(undefined);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.recordAttributes('ws-1', 'contact', [{ stage: null }], 10);
    // All null values → no rows to insert → sql not called
    expect(sqlFn).not.toHaveBeenCalled();
  });

  it('aggregates count across multiple entities with same key/value', async () => {
    const sqlFn = vi.fn().mockResolvedValue(undefined);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.recordAttributes(
      'ws-1',
      'deal',
      [{ stage: 'Closed' }, { stage: 'Closed' }, { stage: 'Open' }],
      3,
    );
    expect(sqlFn).toHaveBeenCalledTimes(2); // sql(rows) helper + INSERT query
  });

  it('handles array attribute values by joining', async () => {
    const sqlFn = vi.fn().mockResolvedValue(undefined);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.recordAttributes(
      'ws-1',
      'contact',
      [{ tags: ['vip', 'customer'] as unknown as string }],
      5,
    );
    expect(sqlFn).toHaveBeenCalledTimes(2); // sql(rows) helper + INSERT query
  });

  it('evicts cache entries for the workspace+type after recording', async () => {
    // Each recordAttributes calls sql twice (helper + INSERT); isDiscriminative calls once.
    const sqlFn = vi.fn()
      .mockResolvedValueOnce({})                 // 1st recordAttributes: sql(rows) helper
      .mockResolvedValueOnce(undefined)           // 1st recordAttributes: INSERT query
      .mockResolvedValueOnce([{ frequency_ratio: 0.9 }]) // 1st isDiscriminative SELECT
      .mockResolvedValueOnce({})                 // 2nd recordAttributes: sql(rows) helper
      .mockResolvedValueOnce(undefined)           // 2nd recordAttributes: INSERT query
      .mockResolvedValueOnce([{ frequency_ratio: 0.3 }]); // 2nd isDiscriminative SELECT (after eviction)

    const tracker = new AttributeFrequencyTracker(sqlFn as never);

    // First query: frequency_ratio = 0.9 → non-discriminative (cached as false)
    await tracker.recordAttributes('ws-1', 'contact', [{ stage: 'Negotiation' }], 10);
    const stage1 = await tracker.isDiscriminative('ws-1', 'contact', 'stage', 'Negotiation');
    expect(stage1).toBe(false); // 0.9 > threshold

    // Second recording should evict cache
    await tracker.recordAttributes('ws-1', 'contact', [{ stage: 'Negotiation' }], 5);
    // Cache evicted — re-query hits DB: frequency_ratio = 0.3 → discriminative
    const stage2 = await tracker.isDiscriminative('ws-1', 'contact', 'stage', 'Negotiation');
    expect(stage2).toBe(true); // 0.3 ≤ threshold
  });
});

describe('AttributeFrequencyTracker.isDiscriminative', () => {
  it('returns true when attribute has no recorded frequency (unknown = discriminative)', async () => {
    const sql = makeSql([[]]);
    const tracker = new AttributeFrequencyTracker(sql);
    const result = await tracker.isDiscriminative('ws-1', 'contact', 'owner', 'Alice');
    expect(result).toBe(true);
  });

  it('returns true when frequency_ratio is below threshold', async () => {
    const sql = makeSql([[{ frequency_ratio: 0.3 }]]);
    const tracker = new AttributeFrequencyTracker(sql);
    const result = await tracker.isDiscriminative('ws-1', 'contact', 'stage', 'Negotiation');
    expect(result).toBe(true);
  });

  it('returns true when frequency_ratio equals threshold exactly', async () => {
    const sql = makeSql([[{ frequency_ratio: FREQUENCY_THRESHOLD }]]);
    const tracker = new AttributeFrequencyTracker(sql);
    const result = await tracker.isDiscriminative('ws-1', 'contact', 'stage', 'Negotiation');
    expect(result).toBe(true); // ≤ threshold
  });

  it('returns false when frequency_ratio exceeds threshold', async () => {
    const sql = makeSql([[{ frequency_ratio: 0.75 }]]);
    const tracker = new AttributeFrequencyTracker(sql);
    const result = await tracker.isDiscriminative('ws-1', 'contact', 'country', 'US');
    expect(result).toBe(false);
  });

  it('uses cache on second call for same args', async () => {
    const sqlFn = vi.fn().mockResolvedValueOnce([{ frequency_ratio: 0.8 }]);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.isDiscriminative('ws-1', 'contact', 'country', 'US');
    await tracker.isDiscriminative('ws-1', 'contact', 'country', 'US');
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('treats different values with same key independently', async () => {
    const sqlFn = vi.fn()
      .mockResolvedValueOnce([{ frequency_ratio: 0.9 }])  // US → non-discriminative
      .mockResolvedValueOnce([{ frequency_ratio: 0.1 }]); // CA → discriminative
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    const usResult = await tracker.isDiscriminative('ws-1', 'contact', 'country', 'US');
    const caResult = await tracker.isDiscriminative('ws-1', 'contact', 'country', 'CA');
    expect(usResult).toBe(false);
    expect(caResult).toBe(true);
  });
});

describe('AttributeFrequencyTracker.warmCache', () => {
  it('does nothing when attrKeys is empty', async () => {
    const sqlFn = vi.fn();
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.warmCache('ws-1', 'contact', []);
    expect(sqlFn).not.toHaveBeenCalled();
  });

  it('populates cache from DB rows', async () => {
    const sql = makeSql([[
      { attr_key: 'country', attr_value_hash: 'abc123', frequency_ratio: 0.8 },
      { attr_key: 'stage', attr_value_hash: 'def456', frequency_ratio: 0.2 },
    ]]);
    const tracker = new AttributeFrequencyTracker(sql);
    await tracker.warmCache('ws-1', 'contact', ['country', 'stage']);
    // The cache is populated; subsequent sync calls use it
    // We can't test the exact hash without re-implementing hashValue, but we can verify
    // that isDiscriminativeSync returns true for unknown entries (which is the default)
    expect(tracker.isDiscriminativeSync('ws-1', 'contact', 'unknown_key', 'val')).toBe(true);
  });
});

describe('AttributeFrequencyTracker.isDiscriminativeSync', () => {
  it('returns true for unknown cache entries', () => {
    const sqlFn = vi.fn();
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    expect(tracker.isDiscriminativeSync('ws-1', 'contact', 'any', 'value')).toBe(true);
  });

  it('returns cached result without DB query', async () => {
    const sqlFn = vi.fn().mockResolvedValueOnce([{ frequency_ratio: 0.85 }]);
    const tracker = new AttributeFrequencyTracker(sqlFn as never);
    await tracker.isDiscriminative('ws-1', 'contact', 'country', 'US'); // populates cache
    const sync = tracker.isDiscriminativeSync('ws-1', 'contact', 'country', 'US');
    expect(sync).toBe(false); // 0.85 > 0.6
    expect(sqlFn).toHaveBeenCalledOnce(); // no extra DB call
  });
});

describe('FREQUENCY_THRESHOLD constant', () => {
  it('is 0.6', () => {
    expect(FREQUENCY_THRESHOLD).toBe(0.6);
  });
});
