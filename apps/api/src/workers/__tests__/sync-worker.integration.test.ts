/**
 * Integration-style tests for the sync worker.
 * Uses mocked Postgres, mocked connector registry, and mocked indexer
 * to verify the full sync execution flow without real external services.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('bullmq', () => {
  const handlerRef: { fn?: (job: unknown) => Promise<void> } = {};
  const workerEvents = new Map<string, (...args: unknown[]) => void>();

  const Worker = vi.fn().mockImplementation((_queue: string, handler: (job: unknown) => Promise<void>, _opts: unknown) => {
    handlerRef.fn = handler;
    return {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        workerEvents.set(event, cb);
      }),
      _handlerRef: handlerRef,
    };
  });

  return { Worker };
});

vi.mock('@iris/semantic-core/sync-events', () => ({
  emitSyncEvent: vi.fn(),
}));

vi.mock('@iris/semantic-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core')>();
  return {
    ...actual,
    indexEntities: vi.fn().mockResolvedValue({
      created: 3,
      updated: 1,
      deduplicated: 0,
      failed: 0,
      durationMs: 42,
    }),
  };
});

vi.mock('@iris/connector-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/connector-sdk')>();
  return {
    ...actual,
    registry: {
      get: vi.fn(),
    },
  };
});

vi.mock('../../services/connector-service.js', () => ({
  ConnectorService: vi.fn(),
}));

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { registry } from '@iris/connector-sdk';
import { indexEntities } from '@iris/semantic-core';
import { emitSyncEvent } from '@iris/semantic-core/sync-events';
import { ConnectorService } from '../../services/connector-service.js';
import { createSyncWorker } from '../sync-worker.js';
import type { VectorStore } from '@iris/semantic-core';
import type postgres from 'postgres';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeVectorStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    listByType: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  } as unknown as VectorStore;
}

type MockSql = ReturnType<typeof postgres>;

function makeSql(): MockSql {
  return {} as unknown as MockSql;
}

function makeJob(overrides: Partial<Job['data']> = {}): Job {
  return {
    id: 'job-1',
    data: {
      connectorInstanceId: 'inst-abc',
      workspaceId: 'ws-1',
      triggeredAt: new Date().toISOString(),
      ...overrides,
    },
  } as unknown as Job;
}

function makeConnectorInstance() {
  return {
    id: 'inst-abc',
    workspaceId: 'ws-1',
    connectorId: 'hubspot',
    config: { apiKey: 'test' },
    status: 'active' as const,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function getJobHandler(): Promise<(job: Job) => Promise<void>> {
  const workerInstance = vi.mocked(Worker).mock.results[0]?.value;
  const handlerRef = workerInstance?._handlerRef as { fn?: (job: Job) => Promise<void> };
  if (!handlerRef?.fn) throw new Error('Worker handler not captured');
  return handlerRef.fn;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createSyncWorker', () => {
  let mockConnectorService: {
    getInstance: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnectorService = {
      getInstance: vi.fn().mockResolvedValue(ok(makeConnectorInstance())),
      updateStatus: vi.fn().mockResolvedValue(ok(undefined)),
    };

    vi.mocked(ConnectorService).mockImplementation(() => mockConnectorService as unknown as ConnectorService);
  });

  describe('happy path', () => {
    it('creates a BullMQ worker on the sync queue', () => {
      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost:6379');
      expect(Worker).toHaveBeenCalledWith(
        'connector-sync',
        expect.any(Function),
        expect.objectContaining({ concurrency: 5 }),
      );
    });

    it('fetches the connector instance by id and workspaceId', async () => {
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();
      await handler(makeJob());

      expect(mockConnectorService.getInstance).toHaveBeenCalledWith('ws-1', 'inst-abc');
    });

    it('marks status as syncing then active on success', async () => {
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();
      await handler(makeJob());

      expect(mockConnectorService.updateStatus).toHaveBeenCalledWith('inst-abc', 'syncing');
      expect(mockConnectorService.updateStatus).toHaveBeenCalledWith('inst-abc', 'active', expect.any(Date));
    });

    it('calls indexEntities with the connector sync generator', async () => {
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'my-openai-key', 'redis://localhost');
      const handler = await getJobHandler();
      await handler(makeJob());

      expect(indexEntities).toHaveBeenCalledWith(
        expect.anything(), // the generator
        expect.anything(), // the vector store
        expect.objectContaining({ openAiApiKey: 'my-openai-key' }),
      );
    });

    it('passes lastSyncedAt to sync() for incremental sync', async () => {
      const lastSynced = new Date('2024-01-01');
      mockConnectorService.getInstance = vi.fn().mockResolvedValue(
        ok({ ...makeConnectorInstance(), lastSyncedAt: lastSynced }),
      );

      const mockSync = vi.fn().mockImplementation(async function* () { yield* []; });
      const mockConnector = { connect: vi.fn().mockResolvedValue(ok(undefined)), sync: mockSync };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();
      await handler(makeJob());

      expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedAt: lastSynced }));
    });

    it('emits sync_started and sync_completed events', async () => {
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();
      await handler(makeJob());

      const calls = vi.mocked(emitSyncEvent).mock.calls.map((c) => c[0].eventType);
      expect(calls).toContain('sync_started');
      expect(calls).toContain('sync_completed');
    });
  });

  describe('error handling', () => {
    it('throws if the connector instance is not found', async () => {
      mockConnectorService.getInstance = vi.fn().mockResolvedValue(ok(null));

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();

      await expect(handler(makeJob())).rejects.toThrow('not found');
    });

    it('throws if getInstance returns an error', async () => {
      mockConnectorService.getInstance = vi.fn().mockResolvedValue(err(new Error('DB timeout')));

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();

      await expect(handler(makeJob())).rejects.toThrow('DB timeout');
    });

    it('marks status as error and emits sync_failed when indexEntities throws', async () => {
      vi.mocked(indexEntities).mockRejectedValueOnce(new Error('embedding service down'));
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();

      await expect(handler(makeJob())).rejects.toThrow('embedding service down');

      expect(mockConnectorService.updateStatus).toHaveBeenCalledWith('inst-abc', 'error');
      const failedEvent = vi.mocked(emitSyncEvent).mock.calls.find(
        (c) => c[0].eventType === 'sync_failed',
      );
      expect(failedEvent).toBeDefined();
    });

    it('rethrows the error so BullMQ can retry', async () => {
      vi.mocked(indexEntities).mockRejectedValueOnce(new Error('transient failure'));
      const mockConnector = {
        connect: vi.fn().mockResolvedValue(ok(undefined)),
        sync: vi.fn().mockImplementation(async function* () { yield* []; }),
      };
      vi.mocked(registry.get).mockReturnValue({
        manifest: {} as unknown as ReturnType<typeof registry.get>['manifest'],
        factory: vi.fn().mockReturnValue(mockConnector),
      });

      createSyncWorker(makeSql(), makeVectorStore(), 'key', 'redis://localhost');
      const handler = await getJobHandler();

      await expect(handler(makeJob())).rejects.toThrow('transient failure');
    });
  });
});
