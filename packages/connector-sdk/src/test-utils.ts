import { vi } from 'vitest';
import type { SemanticEntity, SyncOptions, ConnectorSchema, HealthStatus } from './base-connector.js';
import { BaseConnector } from './base-connector.js';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { ConnectorError } from './base-connector.js';

/** A concrete mock connector for use in unit tests. */
class MockConnector<TConfig = unknown> extends BaseConnector<TConfig> {
  connect = vi.fn<[TConfig], Promise<Result<void, ConnectorError>>>().mockResolvedValue(ok(undefined));

  sync = vi.fn<[SyncOptions], AsyncGenerator<SemanticEntity>>().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function* (_options: SyncOptions) {
      // yields nothing by default; override in tests
    },
  );

  getSchema = vi.fn<[], Promise<ConnectorSchema>>().mockResolvedValue({
    entityTypes: [],
    version: '1.0.0',
  });

  healthCheck = vi.fn<[], Promise<HealthStatus>>().mockResolvedValue({
    healthy: true,
    latencyMs: 10,
    checkedAt: new Date(),
  });
}

/**
 * Create a mock connector instance with all methods stubbed via vi.fn().
 * Override individual methods in your test as needed.
 */
export function createMockConnector<TConfig = unknown>(): MockConnector<TConfig> {
  return new MockConnector<TConfig>();
}

/**
 * Assert that an object satisfies the SemanticEntity shape.
 * Throws if any required field is missing or malformed.
 */
export function assertEntityShape(entity: unknown): asserts entity is SemanticEntity {
  if (typeof entity !== 'object' || entity === null) {
    throw new Error(`Expected SemanticEntity object, got ${typeof entity}`);
  }

  const e = entity as Record<string, unknown>;

  if (typeof e['id'] !== 'string' || !e['id'].includes(':')) {
    throw new Error(`entity.id must be a namespaced string like 'connector:type:externalId', got: ${String(e['id'])}`);
  }

  if (typeof e['type'] !== 'string' || e['type'].length === 0) {
    throw new Error(`entity.type must be a non-empty string`);
  }

  if (typeof e['label'] !== 'string' || e['label'].length === 0) {
    throw new Error(`entity.label must be a non-empty string`);
  }

  if (typeof e['attributes'] !== 'object' || e['attributes'] === null || Array.isArray(e['attributes'])) {
    throw new Error(`entity.attributes must be a plain object`);
  }

  if (!Array.isArray(e['relationships'])) {
    throw new Error(`entity.relationships must be an array`);
  }

  if (!(e['lastModified'] instanceof Date)) {
    throw new Error(`entity.lastModified must be a Date`);
  }

  if (typeof e['sourceId'] !== 'string' || e['sourceId'].length === 0) {
    throw new Error(`entity.sourceId must be a non-empty string`);
  }
}
