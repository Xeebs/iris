import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityAuditService } from '../entity-audit-service.js';

type MockSql = ReturnType<typeof vi.fn> & { array: ReturnType<typeof vi.fn> };

function makeSql(returnValue: unknown[] = []): MockSql {
  const fn = vi.fn().mockResolvedValue(returnValue) as MockSql;
  fn.array = vi.fn((v: unknown[]) => v);
  return fn;
}

describe('EntityAuditService', () => {
  describe('trackChange', () => {
    it('inserts a created event and returns an audit record', async () => {
      const row = {
        id: 'uuid-1',
        workspace_id: 'ws-1',
        entity_id: 'hubspot:contact:1',
        entity_type: 'contact',
        change_type: 'created',
        changed_by: 'connector_sync',
        source_connector_id: 'hubspot',
        old_values_json: null,
        new_values_json: { name: 'Alice' },
        changed_fields: [],
        anomaly_flags: [],
        timestamp: new Date('2026-01-01T00:00:00Z'),
      };
      const sql = makeSql([row]);
      const service = new EntityAuditService(sql as never);

      const result = await service.trackChange('ws-1', 'hubspot:contact:1', 'contact', 'created', 'connector_sync', {
        newValues: { name: 'Alice' },
        sourceConnectorId: 'hubspot',
      });

      expect(result.isOk()).toBe(true);
      const event = result._unsafeUnwrap();
      expect(event.changeType).toBe('created');
      expect(event.entityId).toBe('hubspot:contact:1');
      expect(event.changedBy).toBe('connector_sync');
      expect(event.sourceConnectorId).toBe('hubspot');
    });

    it('computes changed fields for updated events', async () => {
      const row = {
        id: 'uuid-2',
        workspace_id: 'ws-1',
        entity_id: 'e-1',
        entity_type: 'contact',
        change_type: 'updated',
        changed_by: 'webhook',
        source_connector_id: null,
        old_values_json: { name: 'Alice', stage: 'lead' },
        new_values_json: { name: 'Alice', stage: 'customer' },
        changed_fields: ['stage'],
        anomaly_flags: [],
        timestamp: new Date(),
      };
      const sql = makeSql([row]);
      const service = new EntityAuditService(sql as never);

      const result = await service.trackChange('ws-1', 'e-1', 'contact', 'updated', 'webhook', {
        oldValues: { name: 'Alice', stage: 'lead' },
        newValues: { name: 'Alice', stage: 'customer' },
      });

      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalled();
    });

    it('does not compute changedFields for created events', async () => {
      const row = {
        id: 'u3', workspace_id: 'ws', entity_id: 'e3', entity_type: 'deal',
        change_type: 'created', changed_by: 'user_import', source_connector_id: null,
        old_values_json: null, new_values_json: { amount: 5000 },
        changed_fields: [], anomaly_flags: [], timestamp: new Date(),
      };
      const sql = makeSql([row]);
      const service = new EntityAuditService(sql as never);

      const result = await service.trackChange('ws', 'e3', 'deal', 'created', 'user_import', {
        newValues: { amount: 5000 },
      });

      expect(result.isOk()).toBe(true);
    });

    it('returns err when SQL throws', async () => {
      const sql = makeSql();
      sql.mockRejectedValue(new Error('DB down'));
      const service = new EntityAuditService(sql as never);

      const result = await service.trackChange('ws', 'e', 'contact', 'created', 'manual');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB down');
    });

    it('returns err when insert returns no rows', async () => {
      const sql = makeSql([]);
      const service = new EntityAuditService(sql as never);

      const result = await service.trackChange('ws', 'e', 'contact', 'created', 'manual');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('no rows');
    });
  });

  describe('getHistory', () => {
    it('returns events ordered by timestamp for an entity', async () => {
      const rows = [
        {
          id: 'u1', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'updated', changed_by: 'connector_sync', source_connector_id: null,
          old_values_json: null, new_values_json: null, changed_fields: [], anomaly_flags: [],
          timestamp: new Date('2026-01-02'),
        },
        {
          id: 'u2', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'created', changed_by: 'connector_sync', source_connector_id: null,
          old_values_json: null, new_values_json: null, changed_fields: [], anomaly_flags: [],
          timestamp: new Date('2026-01-01'),
        },
      ];
      const sql = makeSql(rows);
      const service = new EntityAuditService(sql as never);

      const result = await service.getHistory('ws', 'e1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('passes time range to SQL query', async () => {
      const sql = makeSql([]);
      const service = new EntityAuditService(sql as never);

      await service.getHistory('ws', 'e1', { from: '2026-01-01', to: '2026-01-31' });
      expect(sql).toHaveBeenCalled();
    });

    it('returns err on SQL failure', async () => {
      const sql = makeSql();
      sql.mockRejectedValue(new Error('timeout'));
      const service = new EntityAuditService(sql as never);

      const result = await service.getHistory('ws', 'e1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getFieldHistory', () => {
    it('extracts field timeline from audit events', async () => {
      const rows = [
        {
          id: 'u1', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'updated', changed_by: 'connector_sync', source_connector_id: null,
          old_values_json: { stage: 'lead' }, new_values_json: { stage: 'qualified' },
          changed_fields: ['stage'], anomaly_flags: [], timestamp: new Date('2026-01-02'),
        },
        {
          id: 'u2', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'created', changed_by: 'connector_sync', source_connector_id: null,
          old_values_json: null, new_values_json: { stage: 'lead' },
          changed_fields: [], anomaly_flags: [], timestamp: new Date('2026-01-01'),
        },
      ];
      const sql = makeSql(rows);
      const service = new EntityAuditService(sql as never);

      const result = await service.getFieldHistory('ws', 'e1', 'stage');
      expect(result.isOk()).toBe(true);
      const history = result._unsafeUnwrap();
      expect(history.field).toBe('stage');
      expect(history.timeline).toHaveLength(2);
      expect(history.timeline[0]!.value).toBe('lead');
      expect(history.timeline[1]!.value).toBe('qualified');
    });

    it('returns empty timeline when no events have that field', async () => {
      const rows = [
        {
          id: 'u1', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'created', changed_by: 'connector_sync', source_connector_id: null,
          old_values_json: null, new_values_json: { name: 'Alice' },
          changed_fields: [], anomaly_flags: [], timestamp: new Date(),
        },
      ];
      const sql = makeSql(rows);
      const service = new EntityAuditService(sql as never);

      const result = await service.getFieldHistory('ws', 'e1', 'missing_field');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().timeline).toHaveLength(0);
    });

    it('propagates SQL error from getHistory', async () => {
      const sql = makeSql();
      sql.mockRejectedValue(new Error('db error'));
      const service = new EntityAuditService(sql as never);

      const result = await service.getFieldHistory('ws', 'e1', 'stage');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('detectAnomalies', () => {
    it('returns anomalies for rapid recreation', async () => {
      const sql = vi.fn() as MockSql;
      sql.array = vi.fn((v: unknown[]) => v);

      sql
        .mockResolvedValueOnce([{ entity_id: 'e1', deletions: 3, creations: 2 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const service = new EntityAuditService(sql as never);
      const result = await service.detectAnomalies('ws');

      expect(result.isOk()).toBe(true);
      const anomalies = result._unsafeUnwrap();
      expect(anomalies.some((a) => a.anomalyType === 'rapid_recreation')).toBe(true);
    });

    it('returns anomalies for frequent updates', async () => {
      const sql = vi.fn() as MockSql;
      sql.array = vi.fn((v: unknown[]) => v);
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ entity_id: 'e2', update_count: 150 }])
        .mockResolvedValueOnce([]);

      const service = new EntityAuditService(sql as never);
      const result = await service.detectAnomalies('ws');

      expect(result.isOk()).toBe(true);
      const anomalies = result._unsafeUnwrap();
      expect(anomalies.some((a) => a.anomalyType === 'frequent_updates' && a.severity === 'high')).toBe(true);
    });

    it('returns anomalies for bulk deletions', async () => {
      const sql = vi.fn() as MockSql;
      sql.array = vi.fn((v: unknown[]) => v);
      sql
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ bucket: new Date(), count: 300 }]);

      const service = new EntityAuditService(sql as never);
      const result = await service.detectAnomalies('ws');

      expect(result.isOk()).toBe(true);
      const anomalies = result._unsafeUnwrap();
      expect(anomalies.some((a) => a.anomalyType === 'bulk_deletion' && a.severity === 'high')).toBe(true);
    });

    it('returns ok with empty list when no anomalies', async () => {
      const sql = vi.fn() as MockSql;
      sql.array = vi.fn((v: unknown[]) => v);
      sql.mockResolvedValue([]);

      const service = new EntityAuditService(sql as never);
      const result = await service.detectAnomalies('ws');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err on SQL failure', async () => {
      const sql = vi.fn() as MockSql;
      sql.array = vi.fn((v: unknown[]) => v);
      sql.mockRejectedValue(new Error('query failed'));

      const service = new EntityAuditService(sql as never);
      const result = await service.detectAnomalies('ws');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('listRecentEvents', () => {
    it('returns events without entity type filter', async () => {
      const rows = [
        {
          id: 'u1', workspace_id: 'ws', entity_id: 'e1', entity_type: 'contact',
          change_type: 'created', changed_by: 'manual', source_connector_id: null,
          old_values_json: null, new_values_json: null, changed_fields: [], anomaly_flags: [],
          timestamp: new Date(),
        },
      ];
      const sql = makeSql(rows);
      const service = new EntityAuditService(sql as never);

      const result = await service.listRecentEvents('ws');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });

    it('filters by entity type when provided', async () => {
      const sql = makeSql([]);
      const service = new EntityAuditService(sql as never);

      const result = await service.listRecentEvents('ws', 'deal');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalled();
    });

    it('returns err on SQL failure', async () => {
      const sql = makeSql();
      sql.mockRejectedValue(new Error('conn error'));
      const service = new EntityAuditService(sql as never);

      const result = await service.listRecentEvents('ws');
      expect(result.isErr()).toBe(true);
    });
  });
});
