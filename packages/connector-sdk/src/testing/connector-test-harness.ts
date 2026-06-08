import { vi } from 'vitest';
import type {
  SemanticEntity,
  SyncOptions,
  ConnectorSchema,
  HealthStatus,
  ConnectorManifest,
} from '../base-connector.js';
import { assertEntityShape } from '../test-utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockAPIResponse {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  status?: number;
  body: unknown;
}

export interface TestConnectorConfig {
  connectorId: string;
  apiBaseUrl: string;
  apiKey?: string;
}

export interface SyncAssertionOptions {
  expectedCount?: number;
  expectedTypes?: string[];
  validateShapes?: boolean;
}

export interface LatencySLAOptions {
  maxMs: number;
}

export interface ConnectorTestReport {
  connectorId: string;
  passCount: number;
  failCount: number;
  totalDurationMs: number;
  results: Array<{ name: string; passed: boolean; durationMs: number; error?: string }>;
}

// ─── ConnectorTestHarness ─────────────────────────────────────────────────────

/**
 * Test harness for Iris connector developers.
 * Provides structured helpers for mocking APIs, asserting sync output,
 * and validating entity shapes without real network calls.
 */
export class ConnectorTestHarness {
  private readonly mockFetch: ReturnType<typeof vi.fn>;
  private readonly handlers = new Map<string, MockAPIResponse>();

  constructor(private readonly config: TestConnectorConfig) {
    this.mockFetch = vi.fn();
    globalThis.fetch = this.mockFetch as typeof fetch;
  }

  /**
   * Register mock HTTP responses keyed by `${method} ${path}`.
   * Called before invoking connector methods in tests.
   *
   * @param responses - Array of mock response definitions
   */
  mockConnectorAPI(responses: MockAPIResponse[]): void {
    for (const r of responses) {
      const method = r.method ?? 'GET';
      const key = `${method} ${r.path}`;
      this.handlers.set(key, r);
    }

    this.mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const pathname = new URL(url, this.config.apiBaseUrl).pathname;
      const key = `${method} ${pathname}`;
      const handler = this.handlers.get(key);

      const status = handler?.status ?? (handler ? 200 : 404);
      const body = handler?.body ?? { error: 'Not found' };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  }

  /**
   * Collect all entities emitted by a connector's sync generator.
   *
   * @param generator - Async generator returned by connector.sync()
   * @returns         - Collected entities
   */
  async collectSyncOutput(generator: AsyncGenerator<SemanticEntity>): Promise<SemanticEntity[]> {
    const entities: SemanticEntity[] = [];
    for await (const entity of generator) {
      entities.push(entity);
    }
    return entities;
  }

  /**
   * Assert that sync output matches expectations.
   * Optionally validates each entity's shape using assertEntityShape.
   *
   * @param entities - Entities collected from collectSyncOutput
   * @param options  - Assertion options
   */
  assertSyncOutput(entities: SemanticEntity[], options: SyncAssertionOptions = {}): void {
    if (options.expectedCount !== undefined && entities.length !== options.expectedCount) {
      throw new Error(
        `Expected ${options.expectedCount} entities from sync, got ${entities.length}`,
      );
    }

    if (options.expectedTypes) {
      const actualTypes = new Set(entities.map((e) => e.type));
      for (const expectedType of options.expectedTypes) {
        if (!actualTypes.has(expectedType)) {
          throw new Error(
            `Expected entity type "${expectedType}" in sync output, but got: ${[...actualTypes].join(', ')}`,
          );
        }
      }
    }

    if (options.validateShapes !== false) {
      for (const entity of entities) {
        assertEntityShape(entity);
      }
    }
  }

  /**
   * Assert that an entity conforms to the SemanticEntity shape.
   * Delegates to the shared assertEntityShape utility.
   *
   * @param entity - Entity to validate
   */
  assertEntityShape(entity: unknown): asserts entity is SemanticEntity {
    assertEntityShape(entity);
  }

  /**
   * Assert that an operation completes within a latency SLA.
   *
   * @param operation - Async operation to time
   * @param options   - SLA options (maxMs)
   * @returns         - Result of the operation
   */
  async assertWithinLatency<T>(
    operation: () => Promise<T>,
    options: LatencySLAOptions,
  ): Promise<T> {
    const start = Date.now();
    const result = await operation();
    const elapsed = Date.now() - start;

    if (elapsed > options.maxMs) {
      throw new Error(
        `Operation exceeded latency SLA: took ${elapsed}ms, max allowed is ${options.maxMs}ms`,
      );
    }

    return result;
  }

  /**
   * Assert that a connector manifest is fully configured.
   *
   * @param manifest - Manifest to validate
   */
  assertManifest(manifest: ConnectorManifest): void {
    if (!manifest.id || !manifest.name) {
      throw new Error('Manifest must have id and name');
    }
    if (!manifest.configSchema) {
      throw new Error('Manifest must have configSchema');
    }
    if (!manifest.entityTypes || manifest.entityTypes.length === 0) {
      throw new Error('Manifest must declare at least one entityType');
    }
    if (!manifest.auth || !manifest.auth.type) {
      throw new Error('Manifest must declare auth.type');
    }
  }

  /**
   * Assert that a schema has the expected entity types.
   *
   * @param schema        - Schema from connector.getSchema()
   * @param expectedTypes - Entity type names that must appear in the schema
   */
  assertSchema(schema: ConnectorSchema, expectedTypes: string[]): void {
    const typeNames = schema.entityTypes.map((t) => t.name);
    for (const expected of expectedTypes) {
      if (!typeNames.includes(expected)) {
        throw new Error(
          `Expected entity type "${expected}" in schema, got: ${typeNames.join(', ')}`,
        );
      }
    }
  }

  /**
   * Assert that a health check result is valid.
   *
   * @param status - HealthStatus from connector.healthCheck()
   */
  assertHealthStatus(status: HealthStatus): void {
    if (typeof status.healthy !== 'boolean') {
      throw new Error('HealthStatus.healthy must be a boolean');
    }
    if (!(status.checkedAt instanceof Date)) {
      throw new Error('HealthStatus.checkedAt must be a Date');
    }
  }

  /** Reset mock state between tests */
  reset(): void {
    this.handlers.clear();
    this.mockFetch.mockReset();
  }
}

// ─── Sync Options Builder ─────────────────────────────────────────────────────

/**
 * Build standard SyncOptions for test scenarios.
 *
 * @param overrides - Partial options to override defaults
 */
export function makeSyncOptions(overrides: Partial<SyncOptions> = {}): SyncOptions {
  return {
    entityTypes: [],
    limit: 50,
    ...overrides,
  };
}

/**
 * Build a minimal valid SemanticEntity for use in tests.
 *
 * @param overrides - Fields to override
 */
export function makeEntity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: 'test:contact:1',
    type: 'contact',
    label: 'Test Contact',
    attributes: {},
    relationships: [],
    lastModified: new Date('2026-01-01T00:00:00Z'),
    sourceId: 'test:contact:1',
    ...overrides,
  };
}
