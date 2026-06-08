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
    const sqlFn = vi.fn().mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    await expect(service.recordOrigin('entity-1', 'ws-1', origin)).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('handles origin with no optional fields', async () => {
    const sqlFn = vi.fn().mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    await expect(
      service.recordOrigin('entity-2', 'ws-1', { connectorId: 'slack' }),
    ).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });
});

describe('DataLineageService.addTransformation', () => {
  it('calls sql to upsert-append the transformation', async () => {
    const sqlFn = vi.fn().mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    await expect(
      service.addTransformation('entity-1', 'ws-1', transformation),
    ).resolves.not.toThrow();
    expect(sqlFn).toHaveBeenCalledOnce();
  });

  it('accepts all transformation types', async () => {
    const sqlFn = vi.fn().mockResolvedValue([]);
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
    const sqlFn = vi.fn().mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    await service.recordOriginBatch([]);
    expect(sqlFn).not.toHaveBeenCalled();
  });

  it('calls sql twice (helper + INSERT) for non-empty batch', async () => {
    const sqlFn = vi.fn().mockResolvedValue([]);
    const service = new DataLineageService(sqlFn as never);
    await service.recordOriginBatch([
      { entityId: 'e1', workspaceId: 'ws-1', origin: { connectorId: 'hubspot' } },
      { entityId: 'e2', workspaceId: 'ws-1', origin: { connectorId: 'slack' } },
    ]);
    expect(sqlFn).toHaveBeenCalledTimes(2); // sql(rows) helper + INSERT query
  });
});
