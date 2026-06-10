import { describe, it, expect, vi } from 'vitest';
import { DataLineageService } from '../data-lineage.js';
import type { LineageOrigin, LineageTransformation } from '../data-lineage.js';

function makeSql(rowSets: unknown[][]): ReturnType<typeof import('postgres')['default']> {
  let call = 0;
  return Object.assign(
    (..._args: unknown[]) => {
      const rows = rowSets[call] ?? [];
      call++;
      return Promise.resolve(rows);
    },
    // services call sql.json() for jsonb params; echo the value through
    { json: (v: unknown) => v },
  ) as unknown as ReturnType<typeof import('postgres')['default']>;
}

const origin: LineageOrigin = {
  connectorId: 'hubspot',
  syncJobId: 'job-123',
  sourceApiTimestamp: new Date('2026-01-01T00:00:00Z'),
  modifiedBy: 'system',
};

const transformation: LineageTransformation = {
  type: 'embedding',
  timestamp: '2026-01-01T01:00:00.000Z',
  metadata: { model: 'text-embedding-3-small', dimensions: 1536 },
};

describe('DataLineageService.recordOrigin', () => {
  it('calls sql without throwing', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    await expect(service.recordOrigin('entity-1', 'ws-1', origin)).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('handles origin with no optional fields', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    await expect(
      service.recordOrigin('entity-2', 'ws-1', { connectorId: 'slack' }),
    ).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });
});

describe('DataLineageService.addTransformation', () => {
  it('calls sql to upsert-append the transformation', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    await expect(
      service.addTransformation('entity-1', 'ws-1', transformation),
    ).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('accepts all transformation types', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    const types: LineageTransformation['type'][] = [
      'embedding', 'deduplication', 'relationship', 'pii_masking', 'enrichment',
    ];
    for (const type of types) {
      await service.addTransformation('entity-1', 'ws-1', {
        type,
        timestamp: new Date().toISOString(),
      });
    }
    expect(sqlFn).toHaveBeenCalledTimes(types.length);
  });
});

describe('DataLineageService.getLineage', () => {
  it('returns null when no record exists', async () => {
    const sql = makeSql([[]]);
    const service = new DataLineageService(sql);
    const result = await service.getLineage('entity-unknown', 'ws-1');
    expect(result).toBeNull();
  });

  it('maps a DB row to a LineageRecord', async () => {
    const dbRow = {
      entity_id: 'hubspot:contact:1',
      workspace_id: 'ws-1',
      source_connector_id: 'hubspot',
      source_sync_job_id: 'job-123',
      source_api_timestamp: new Date('2026-01-01T00:00:00Z'),
      lineage_json: { transformations: [transformation] },
      last_modified_by: 'system',
      last_modified_at: new Date('2026-01-01T01:00:00Z'),
    };
    const sql = makeSql([[dbRow]]);
    const service = new DataLineageService(sql);

    const result = await service.getLineage('hubspot:contact:1', 'ws-1');
    expect(result).not.toBeNull();
    expect(result!.entityId).toBe('hubspot:contact:1');
    expect(result!.sourceConnectorId).toBe('hubspot');
    expect(result!.sourceSyncJobId).toBe('job-123');
    expect(result!.transformations).toHaveLength(1);
    expect(result!.transformations[0]!.type).toBe('embedding');
  });

  it('omits optional fields when null in DB', async () => {
    const dbRow = {
      entity_id: 'hubspot:contact:2',
      workspace_id: 'ws-1',
      source_connector_id: 'hubspot',
      source_sync_job_id: null,
      source_api_timestamp: null,
      lineage_json: { transformations: [] },
      last_modified_by: 'system',
      last_modified_at: new Date('2026-01-01T01:00:00Z'),
    };
    const sql = makeSql([[dbRow]]);
    const service = new DataLineageService(sql);

    const result = await service.getLineage('hubspot:contact:2', 'ws-1');
    expect(result).not.toBeNull();
    expect(result!.sourceSyncJobId).toBeUndefined();
    expect(result!.sourceApiTimestamp).toBeUndefined();
  });

  it('returns empty transformations array when lineage_json has none', async () => {
    const dbRow = {
      entity_id: 'entity-3',
      workspace_id: 'ws-1',
      source_connector_id: 'slack',
      source_sync_job_id: null,
      source_api_timestamp: null,
      lineage_json: { transformations: [] },
      last_modified_by: 'system',
      last_modified_at: new Date(),
    };
    const sql = makeSql([[dbRow]]);
    const service = new DataLineageService(sql);
    const result = await service.getLineage('entity-3', 'ws-1');
    expect(result!.transformations).toEqual([]);
  });
});

describe('DataLineageService.listEntityLineage', () => {
  it('returns empty array when no records exist', async () => {
    const sql = makeSql([[]]);
    const service = new DataLineageService(sql);
    const result = await service.listEntityLineage('ws-empty');
    expect(result).toEqual([]);
  });

  it('returns mapped records', async () => {
    const rows = [
      {
        entity_id: 'e1',
        workspace_id: 'ws-1',
        source_connector_id: 'hubspot',
        source_sync_job_id: null,
        source_api_timestamp: null,
        lineage_json: { transformations: [] },
        last_modified_by: 'system',
        last_modified_at: new Date('2026-01-02'),
      },
      {
        entity_id: 'e2',
        workspace_id: 'ws-1',
        source_connector_id: 'slack',
        source_sync_job_id: 'job-5',
        source_api_timestamp: null,
        lineage_json: { transformations: [transformation] },
        last_modified_by: 'sync-worker',
        last_modified_at: new Date('2026-01-01'),
      },
    ];
    // listEntityLineage has an inner this.sql`` conditional call → 2 total calls.
    // First call is the empty-template placeholder, second is the actual SELECT.
    const sql = makeSql([[], rows]);
    const service = new DataLineageService(sql);

    const result = await service.listEntityLineage('ws-1');
    expect(result).toHaveLength(2);
    expect(result[0]!.entityId).toBe('e1');
    expect(result[1]!.sourceSyncJobId).toBe('job-5');
    expect(result[1]!.transformations[0]!.type).toBe('embedding');
  });
});

describe('DataLineageService.recordOriginBatch', () => {
  it('skips DB call for empty batch', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    await service.recordOriginBatch([]);
    expect(sqlFn).not.toHaveBeenCalled();
  });

  it('calls sql twice (helper + INSERT) for non-empty batch', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    await service.recordOriginBatch([
      { entityId: 'e1', workspaceId: 'ws-1', origin: { connectorId: 'hubspot' } },
      { entityId: 'e2', workspaceId: 'ws-1', origin: { connectorId: 'slack' } },
    ]);
    expect(sqlFn).toHaveBeenCalledTimes(2); // sql(rows) helper + INSERT query
  });
});

describe('DataLineageService.recordDependency', () => {
  it('returns ok on successful upsert', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    const result = await service.recordDependency('e1', 'e2', 'ws-1');
    expect(result.isOk()).toBe(true);
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('uses provided relationship type and confidence', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    const result = await service.recordDependency('e1', 'e2', 'ws-1', 'derived_from', 0.9);
    expect(result.isOk()).toBe(true);
  });

  it('returns err on DB failure', async () => {
    const sqlFn = vi.fn().mockRejectedValue(new Error('constraint'));
    const service = new DataLineageService(sqlFn as never);
    const result = await service.recordDependency('e1', 'e2', 'ws-1');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('constraint');
  });
});

describe('DataLineageService.computeImpact', () => {
  it('returns empty affected list when no dependents', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    const result = await service.computeImpact('e-root', 'ws-1', 2);
    expect(result.isOk()).toBe(true);
    const impact = result._unsafeUnwrap();
    expect(impact.entityId).toBe('e-root');
    expect(impact.affectedEntityIds).toHaveLength(0);
    expect(impact.affectedCount).toBe(0);
  });

  it('returns direct dependents at depth 1', async () => {
    const sqlFn = vi.fn()
      .mockResolvedValueOnce([{ entity_id: 'e-dep1' }, { entity_id: 'e-dep2' }])
      .mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    const result = await service.computeImpact('e-root', 'ws-1', 1);
    expect(result.isOk()).toBe(true);
    const impact = result._unsafeUnwrap();
    expect(impact.affectedEntityIds).toContain('e-dep1');
    expect(impact.affectedEntityIds).toContain('e-dep2');
    expect(impact.affectedCount).toBe(2);
  });

  it('traverses transitively up to maxDepth', async () => {
    const sqlFn = vi.fn()
      .mockResolvedValueOnce([{ entity_id: 'e-dep1' }])  // root deps
      .mockResolvedValueOnce([{ entity_id: 'e-dep2' }])  // e-dep1 deps
      .mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    const result = await service.computeImpact('e-root', 'ws-1', 3);
    expect(result.isOk()).toBe(true);
    const impact = result._unsafeUnwrap();
    expect(impact.affectedEntityIds).toContain('e-dep1');
    expect(impact.affectedEntityIds).toContain('e-dep2');
  });

  it('does not include the root entity in affected list', async () => {
    const sqlFn = vi.fn().mockResolvedValueOnce([{ entity_id: 'e-root' }, { entity_id: 'e-other' }]).mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    const result = await service.computeImpact('e-root', 'ws-1', 2);
    expect(result._unsafeUnwrap().affectedEntityIds).not.toContain('e-root');
  });

  it('returns err on DB failure', async () => {
    const sqlFn = vi.fn().mockRejectedValue(new Error('timeout'));
    const service = new DataLineageService(sqlFn as never);
    const result = await service.computeImpact('e-root', 'ws-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('DataLineageService.getLineageGraph', () => {
  it('returns empty ancestors and descendants when no edges exist', async () => {
    const sqlFn = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
    const service = new DataLineageService(sqlFn as never);
    const result = await service.getLineageGraph('e-root', 'ws-1', 2);
    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(graph.entityId).toBe('e-root');
    expect(graph.ancestors).toHaveLength(0);
    expect(graph.descendants).toHaveLength(0);
  });

  it('returns ancestors (up direction)', async () => {
    // ancestors: 2 up-direction queries (one per BFS level), descendants: 2 down-direction queries
    const sqlFn = vi.fn()
      .mockResolvedValueOnce([{ depends_on_entity_id: 'parent-1', relationship_type: 'derived_from' }])
      .mockResolvedValueOnce([])  // parent-1 has no parents
      .mockResolvedValueOnce([])  // descendants of root
      .mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    const result = await service.getLineageGraph('e-root', 'ws-1', 2);
    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(graph.ancestors).toHaveLength(1);
    expect(graph.ancestors[0]?.entityId).toBe('parent-1');
    expect(graph.ancestors[0]?.relationshipType).toBe('derived_from');
  });

  it('returns err on DB failure', async () => {
    const sqlFn = vi.fn().mockRejectedValue(new Error('DB fail'));
    const service = new DataLineageService(sqlFn as never);
    const result = await service.getLineageGraph('e-root', 'ws-1');
    expect(result.isErr()).toBe(true);
  });
});
