import { describe, it, expect, vi } from 'vitest';
import {
  validateChangeEvent,
  batchCoalesceEvents,
  computeChangeSummary,
  computeCacheInvalidationKeys,
  processChangeEvent,
  enqueueChangeEvent,
  getPendingRetryEvents,
  markEventFailed,
  getEventStreamConfig,
  upsertEventStreamConfig,
  getEventAuditLog,
} from '../event-driven-sync-engine';
import type { EntityChangeEvent } from '../event-driven-sync-engine';

type Sql = Parameters<typeof processChangeEvent>[0];

function makeEvent(overrides: Partial<EntityChangeEvent> = {}): EntityChangeEvent {
  return {
    eventId: 'evt-1',
    connectorId: 'hubspot',
    workspaceId: 'ws1',
    entityId: 'hubspot:contact:123',
    entityType: 'contact',
    changeType: 'entity_updated',
    payload: { name: 'Alice', stage: 'lead' },
    occurredAt: new Date(),
    schemaVersion: '1',
    ...overrides,
  };
}

describe('validateChangeEvent', () => {
  it('returns true for a valid event', () => {
    expect(validateChangeEvent(makeEvent())).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateChangeEvent(null)).toBe(false);
  });

  it('returns false for missing eventId', () => {
    const e = makeEvent();
    const { eventId: _, ...rest } = e;
    expect(validateChangeEvent(rest)).toBe(false);
  });

  it('returns false for invalid changeType', () => {
    expect(validateChangeEvent({ ...makeEvent(), changeType: 'invalid' })).toBe(false);
  });

  it('returns false when occurredAt is not a Date', () => {
    expect(validateChangeEvent({ ...makeEvent(), occurredAt: '2026-06-08' as unknown as Date })).toBe(false);
  });

  it('accepts all valid changeType values', () => {
    const types = ['entity_created', 'entity_updated', 'entity_deleted', 'relationship_changed'];
    for (const t of types) {
      expect(validateChangeEvent(makeEvent({ changeType: t as EntityChangeEvent['changeType'] }))).toBe(true);
    }
  });
});

describe('batchCoalesceEvents', () => {
  it('deduplicates events for same entity, keeping latest', () => {
    const now = Date.now();
    const e1 = makeEvent({ eventId: 'e1', occurredAt: new Date(now - 100) });
    const e2 = makeEvent({ eventId: 'e2', occurredAt: new Date(now - 50) });
    const { coalescedEvents, droppedCount } = batchCoalesceEvents([e1, e2], 1000);
    expect(coalescedEvents).toHaveLength(1);
    expect(coalescedEvents[0]!.eventId).toBe('e2');
    expect(droppedCount).toBe(1);
  });

  it('keeps events for different entities separate', () => {
    const e1 = makeEvent({ entityId: 'e1', eventId: 'ev1' });
    const e2 = makeEvent({ entityId: 'e2', eventId: 'ev2' });
    const { coalescedEvents } = batchCoalesceEvents([e1, e2], 1000);
    expect(coalescedEvents).toHaveLength(2);
  });

  it('filters out events outside the time window', () => {
    const oldEvent = makeEvent({ occurredAt: new Date(Date.now() - 60_000) });
    const { coalescedEvents } = batchCoalesceEvents([oldEvent], 500);
    expect(coalescedEvents).toHaveLength(0);
  });

  it('returns batchedByType counts', () => {
    const events = [
      makeEvent({ changeType: 'entity_created', entityId: 'a', eventId: 'e1' }),
      makeEvent({ changeType: 'entity_updated', entityId: 'b', eventId: 'e2' }),
      makeEvent({ changeType: 'entity_created', entityId: 'c', eventId: 'e3' }),
    ];
    const { batchedByType } = batchCoalesceEvents(events, 1000);
    expect(batchedByType['entity_created']).toBe(2);
    expect(batchedByType['entity_updated']).toBe(1);
  });
});

describe('computeChangeSummary', () => {
  it('summarizes entity_created correctly', () => {
    const s = computeChangeSummary(makeEvent({ changeType: 'entity_created' }));
    expect(s).toContain('Created');
    expect(s).toContain('contact');
  });

  it('summarizes entity_updated with field count', () => {
    const s = computeChangeSummary(makeEvent({ changeType: 'entity_updated', payload: { a: 1, b: 2 } }));
    expect(s).toContain('2');
    expect(s).toContain('Updated');
  });

  it('summarizes entity_deleted', () => {
    const s = computeChangeSummary(makeEvent({ changeType: 'entity_deleted' }));
    expect(s).toContain('Deleted');
  });

  it('summarizes relationship_changed', () => {
    const s = computeChangeSummary(makeEvent({ changeType: 'relationship_changed' }));
    expect(s).toContain('Relationship');
  });
});

describe('computeCacheInvalidationKeys', () => {
  it('always includes entity and context keys', () => {
    const keys = computeCacheInvalidationKeys(makeEvent());
    expect(keys).toContain('entity:ws1:hubspot:contact:123');
    expect(keys).toContain('entities:ws1:contact');
    expect(keys).toContain('context:ws1');
  });

  it('includes relationship key for relationship_changed events', () => {
    const keys = computeCacheInvalidationKeys(makeEvent({ changeType: 'relationship_changed' }));
    expect(keys.some(k => k.includes('relationship'))).toBe(true);
  });

  it('does not include relationship key for entity_created', () => {
    const keys = computeCacheInvalidationKeys(makeEvent({ changeType: 'entity_created' }));
    expect(keys.some(k => k.includes('relationship'))).toBe(false);
  });
});

describe('processChangeEvent', () => {
  it('inserts audit log entry and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await processChangeEvent(sql as unknown as Sql, makeEvent());
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2); // audit log + delivery queue update
  });

  it('returns Err for invalid event', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await processChangeEvent(sql as unknown as Sql, { bad: 'data' } as unknown as EntityChangeEvent);
    expect(result.isErr()).toBe(true);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await processChangeEvent(sql as unknown as Sql, makeEvent());
    expect(result.isErr()).toBe(true);
  });
});

describe('enqueueChangeEvent', () => {
  it('inserts event to delivery queue and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await enqueueChangeEvent(sql as unknown as Sql, makeEvent());
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledOnce();
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await enqueueChangeEvent(sql as unknown as Sql, makeEvent());
    expect(result.isErr()).toBe(true);
  });
});

describe('markEventFailed', () => {
  it('schedules retry with exponential backoff', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ retry_count: 0 }])
      .mockResolvedValueOnce([]);
    const result = await markEventFailed(sql as unknown as Sql, 'ws1', 'evt-1');
    expect(result.isOk()).toBe(true);
  });

  it('sets final failed status when maxRetries exceeded', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ retry_count: 3 }])
      .mockResolvedValueOnce([]);
    const result = await markEventFailed(sql as unknown as Sql, 'ws1', 'evt-1', 3);
    expect(result.isOk()).toBe(true);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await markEventFailed(sql as unknown as Sql, 'ws1', 'evt-1');
    expect(result.isErr()).toBe(true);
  });
});

describe('getPendingRetryEvents', () => {
  it('returns mapped failed events', async () => {
    const sql = vi.fn().mockResolvedValue([
      { event_id: 'evt-1', status: 'failed', retry_count: 1, next_retry_at: null, delivered_at: null },
    ]);
    const result = await getPendingRetryEvents(sql as unknown as Sql, 'ws1');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]!.retryCount).toBe(1);
      expect(result.value[0]!.nextRetryAt).toBeNull();
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getPendingRetryEvents(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});

describe('getEventStreamConfig', () => {
  it('returns null when no config exists', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await getEventStreamConfig(sql as unknown as Sql, 'ws1', 'hubspot');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBeNull();
  });

  it('returns mapped config when found', async () => {
    const sql = vi.fn().mockResolvedValue([
      { connector_id: 'hubspot', workspace_id: 'ws1', enabled: true, event_types: ['entity_created'], config_json: {} },
    ]);
    const result = await getEventStreamConfig(sql as unknown as Sql, 'ws1', 'hubspot');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value?.enabled).toBe(true);
      expect(result.value?.eventTypes).toContain('entity_created');
    }
  });
});

describe('upsertEventStreamConfig', () => {
  it('inserts config and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await upsertEventStreamConfig(sql as unknown as Sql, {
      connectorId: 'hubspot',
      workspaceId: 'ws1',
      enabled: true,
      eventTypes: ['entity_created', 'entity_updated'],
      configJson: {},
    });
    expect(result.isOk()).toBe(true);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await upsertEventStreamConfig(sql as unknown as Sql, {
      connectorId: 'hubspot',
      workspaceId: 'ws1',
      enabled: true,
      eventTypes: [],
      configJson: {},
    });
    expect(result.isErr()).toBe(true);
  });
});

describe('getEventAuditLog', () => {
  it('returns audit entries with pagination', async () => {
    const sql = vi.fn().mockResolvedValue([
      { event_id: 'e1', connector_id: 'hubspot', entity_id: 'c1', change_type: 'entity_updated', change_summary: 'Updated contact: 2 fields changed', delivered_at: '2026-06-08T10:00:00Z', latency_ms: 45 },
      { event_id: 'e2', connector_id: 'salesforce', entity_id: 'c2', change_type: 'entity_created', change_summary: 'Created contact with 5 fields', delivered_at: '2026-06-08T09:00:00Z', latency_ms: 32 },
    ]);
    const result = await getEventAuditLog(sql as unknown as Sql, 'ws1', 2);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entries).toHaveLength(2);
      expect(result.value.nextCursor).toBeNull(); // no extra row returned
    }
  });

  it('sets nextCursor when more results exist', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      event_id: `e${i}`,
      connector_id: 'hubspot',
      entity_id: `c${i}`,
      change_type: 'entity_updated',
      change_summary: 'x',
      delivered_at: null,
      latency_ms: null,
    }));
    const sql = vi.fn().mockResolvedValue(rows);
    const result = await getEventAuditLog(sql as unknown as Sql, 'ws1', 2);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.entries).toHaveLength(2);
      expect(result.value.nextCursor).not.toBeNull();
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getEventAuditLog(sql as unknown as Sql, 'ws1');
    expect(result.isErr()).toBe(true);
  });
});
