import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MultiTenantManager,
  validateWorkspaceClaim,
  validateWorkspaceBoundaries,
  computeEmbeddingCost,
  formatCostUSD,
  projectMonthlyCost,
} from '../multi-tenant-manager.js';
import type { CostStore, WorkspaceCostEntry } from '../multi-tenant-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides?: Partial<CostStore>): CostStore {
  return {
    recordCost: vi.fn().mockResolvedValue(undefined),
    getCosts: vi.fn().mockResolvedValue([]),
    getEntityWorkspace: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeCostEntry(
  partial: Partial<WorkspaceCostEntry> = {},
): WorkspaceCostEntry {
  return {
    workspaceId: 'ws-001',
    date: '2026-06-01',
    costCategory: 'embeddings',
    amountCents: 0.1,
    metadata: {},
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('validateWorkspaceClaim', () => {
  it('returns ok with the workspace ID when both match', () => {
    const result = validateWorkspaceClaim('ws-abc', 'ws-abc');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('ws-abc');
  });

  it('returns err when request workspace ID is missing', () => {
    const result = validateWorkspaceClaim(undefined, 'ws-abc');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('missing_workspace');
  });

  it('returns err when JWT claim does not match request workspace', () => {
    const result = validateWorkspaceClaim('ws-attacker', 'ws-legitimate');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('workspace_mismatch');
  });

  it('allows request when no JWT workspace claim (API key path)', () => {
    const result = validateWorkspaceClaim('ws-abc', undefined);
    expect(result.isOk()).toBe(true);
  });
});

describe('validateWorkspaceBoundaries', () => {
  it('returns ok when all entities match the workspace', () => {
    const entities = [
      { id: 'e1', workspaceId: 'ws-001' },
      { id: 'e2', workspaceId: 'ws-001' },
    ];
    const result = validateWorkspaceBoundaries('ws-001', entities);
    expect(result.isOk()).toBe(true);
  });

  it('returns err on the first entity from a different workspace', () => {
    const entities = [
      { id: 'e1', workspaceId: 'ws-001' },
      { id: 'e2', workspaceId: 'ws-EVIL' },
    ];
    const result = validateWorkspaceBoundaries('ws-001', entities);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('workspace_mismatch');
  });

  it('allows entities without workspaceId field (external-typed objects)', () => {
    const entities = [{ id: 'e1' }, { id: 'e2' }];
    const result = validateWorkspaceBoundaries('ws-001', entities);
    expect(result.isOk()).toBe(true);
  });
});

describe('computeEmbeddingCost', () => {
  it('returns 0 for 0 tokens', () => {
    expect(computeEmbeddingCost(0)).toBe(0);
  });

  it('computes cost at $0.02 / 1M tokens (2 cents / 1M)', () => {
    expect(computeEmbeddingCost(1_000_000)).toBeCloseTo(2);
  });

  it('scales linearly', () => {
    expect(computeEmbeddingCost(500_000)).toBeCloseTo(1);
  });
});

describe('formatCostUSD', () => {
  it('formats zero as $0.0000', () => {
    expect(formatCostUSD(0)).toBe('$0.0000');
  });

  it('formats 100 cents as $1.0000', () => {
    expect(formatCostUSD(100)).toBe('$1.0000');
  });

  it('handles fractional cents', () => {
    expect(formatCostUSD(0.002)).toBe('$0.0000');
  });
});

describe('projectMonthlyCost', () => {
  it('projects daily average to 30-day month', () => {
    expect(projectMonthlyCost(30, 30)).toBeCloseTo(30);
    expect(projectMonthlyCost(10, 10)).toBeCloseTo(30);
  });

  it('returns 0 for zero-day period', () => {
    expect(projectMonthlyCost(100, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MultiTenantManager tests
// ---------------------------------------------------------------------------

describe('MultiTenantManager', () => {
  let store: CostStore;
  let manager: MultiTenantManager;

  beforeEach(() => {
    store = makeStore();
    manager = new MultiTenantManager(store);
  });

  describe('recordEmbeddingCost', () => {
    it('calls store.recordCost with computed amount and category', async () => {
      await manager.recordEmbeddingCost('ws-001', 1_000_000);
      expect(store.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-001',
          costCategory: 'embeddings',
          amountCents: 2,
        }),
      );
    });

    it('includes tokenCount in metadata', async () => {
      await manager.recordEmbeddingCost('ws-001', 50_000, { connector: 'hubspot' });
      const call = vi.mocked(store.recordCost).mock.calls[0]![0];
      expect(call.metadata).toMatchObject({ tokenCount: 50_000, connector: 'hubspot' });
    });
  });

  describe('recordQueryCost', () => {
    it('records query cost when not a cache hit', async () => {
      await manager.recordQueryCost('ws-001', false);
      expect(store.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({ costCategory: 'queries' }),
      );
    });

    it('skips recording on cache hit', async () => {
      await manager.recordQueryCost('ws-001', true);
      expect(store.recordCost).not.toHaveBeenCalled();
    });
  });

  describe('recordCacheMiss', () => {
    it('records cache_miss cost category', async () => {
      await manager.recordCacheMiss('ws-001');
      expect(store.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({ costCategory: 'cache_miss' }),
      );
    });
  });

  describe('computeWorkspaceCosts', () => {
    it('returns zero totals when no cost entries exist', async () => {
      const result = await manager.computeWorkspaceCosts(
        'ws-001',
        new Date('2026-06-01'),
        new Date('2026-06-30'),
      );
      expect(result.totalCents).toBe(0);
      expect(result.byCategory.embeddings).toBe(0);
    });

    it('aggregates costs by category', async () => {
      vi.mocked(store.getCosts).mockResolvedValue([
        makeCostEntry({ costCategory: 'embeddings', amountCents: 5 }),
        makeCostEntry({ costCategory: 'embeddings', amountCents: 3 }),
        makeCostEntry({ costCategory: 'queries', amountCents: 2 }),
      ]);

      const result = await manager.computeWorkspaceCosts(
        'ws-001',
        new Date('2026-06-01'),
        new Date('2026-06-30'),
      );

      expect(result.totalCents).toBeCloseTo(10);
      expect(result.byCategory.embeddings).toBeCloseTo(8);
      expect(result.byCategory.queries).toBeCloseTo(2);
    });

    it('returns dailyTrend sorted ascending by date', async () => {
      vi.mocked(store.getCosts).mockResolvedValue([
        makeCostEntry({ date: '2026-06-03', amountCents: 1 }),
        makeCostEntry({ date: '2026-06-01', amountCents: 2 }),
        makeCostEntry({ date: '2026-06-02', amountCents: 3 }),
      ]);

      const result = await manager.computeWorkspaceCosts(
        'ws-001',
        new Date('2026-06-01'),
        new Date('2026-06-03'),
      );

      expect(result.dailyTrend[0]!.date).toBe('2026-06-01');
      expect(result.dailyTrend[1]!.date).toBe('2026-06-02');
      expect(result.dailyTrend[2]!.date).toBe('2026-06-03');
    });
  });

  describe('validateEntityOwnership', () => {
    it('returns ok when entity belongs to the workspace', async () => {
      vi.mocked(store.getEntityWorkspace).mockResolvedValue('ws-001');
      const result = await manager.validateEntityOwnership('ws-001', 'entity:abc');
      expect(result.isOk()).toBe(true);
    });

    it('returns err entity_not_found when entity does not exist', async () => {
      vi.mocked(store.getEntityWorkspace).mockResolvedValue(null);
      const result = await manager.validateEntityOwnership('ws-001', 'entity:ghost');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().kind).toBe('entity_not_found');
    });

    it('returns err workspace_mismatch when entity belongs to different workspace', async () => {
      vi.mocked(store.getEntityWorkspace).mockResolvedValue('ws-EVIL');
      const result = await manager.validateEntityOwnership('ws-001', 'entity:stolen');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().kind).toBe('workspace_mismatch');
    });
  });
});
