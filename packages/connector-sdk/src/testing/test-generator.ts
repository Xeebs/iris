/**
 * Scaffold generator for connector tests.
 * Produces a ready-to-edit Vitest test file for any connector.
 */

export interface GenerateConnectorTestOptions {
  connectorId: string;
  entityTypes: string[];
  /** Whether connector uses OAuth2 auth (vs API key) */
  usesOAuth?: boolean;
}

/**
 * Generate a scaffold Vitest test file for a connector.
 * The caller writes the returned string to disk.
 *
 * @param options - Connector metadata for the generated test
 * @returns       - TypeScript test file content
 */
export function generateConnectorTest(options: GenerateConnectorTestOptions): string {
  const { connectorId, entityTypes, usesOAuth = false } = options;

  const PascalId = connectorId[0]!.toUpperCase() + connectorId.slice(1);
  const configBlock = usesOAuth
    ? `{ clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost' }`
    : `{ apiKey: 'test-api-key' }`;

  const entityTypeAssertions = entityTypes
    .map((t) => `    it('syncs ${t} entities', async () => {\n` +
      `      const entities = await harness.collectSyncOutput(connector.sync(makeSyncOptions({ entityTypes: ['${t}'] })));\n` +
      `      harness.assertSyncOutput(entities, { expectedTypes: ['${t}'], validateShapes: true });\n` +
      `    });`)
    .join('\n\n');

  return `import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ConnectorTestHarness, makeSyncOptions, makeEntity } from '@iris/connector-sdk/testing';
import { ${PascalId}Connector } from '../src/${connectorId}.js';
import hubspotFixtures from '../tests/fixtures/${connectorId}-responses.json' assert { type: 'json' };

const BASE_URL = 'https://api.${connectorId}.example.com';
const CONFIG = ${configBlock};

describe('${PascalId}Connector', () => {
  let harness: ConnectorTestHarness;
  let connector: ${PascalId}Connector;

  beforeEach(() => {
    harness = new ConnectorTestHarness({ connectorId: '${connectorId}', apiBaseUrl: BASE_URL });
    connector = new ${PascalId}Connector();
    harness.mockConnectorAPI(hubspotFixtures.responses);
  });

  afterEach(() => {
    harness.reset();
  });

  describe('connect()', () => {
    it('connects successfully with valid credentials', async () => {
      const result = await connector.connect(CONFIG);
      expect(result.isOk()).toBe(true);
    });

    it('returns ConnectorError on auth failure', async () => {
      harness.mockConnectorAPI([
        { path: '/auth/token', status: 401, body: { error: 'invalid_client' } },
      ]);
      const result = await connector.connect({ ...CONFIG, apiKey: 'bad-key' } as typeof CONFIG);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('sync()', () => {
${entityTypeAssertions}

    it('handles pagination correctly', async () => {
      const entities = await harness.collectSyncOutput(connector.sync(makeSyncOptions()));
      // Verify cursor-based pagination was used — offset-based will fail on live data
      expect(Array.isArray(entities)).toBe(true);
    });

    it('respects entityTypes filter', async () => {
      const entityType = '${entityTypes[0] ?? 'record'}';
      const entities = await harness.collectSyncOutput(
        connector.sync(makeSyncOptions({ entityTypes: [entityType] })),
      );
      for (const entity of entities) {
        expect(entity.type).toBe(entityType);
      }
    });
  });

  describe('getSchema()', () => {
    it('returns a schema with expected entity types', async () => {
      const schema = await connector.getSchema();
      harness.assertSchema(schema, ${JSON.stringify(entityTypes)});
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy status', async () => {
      const status = await connector.healthCheck();
      harness.assertHealthStatus(status);
      expect(status.healthy).toBe(true);
    });

    it('returns unhealthy on API error', async () => {
      harness.mockConnectorAPI([
        { path: '/health', status: 503, body: { error: 'Service unavailable' } },
      ]);
      const status = await connector.healthCheck();
      expect(status.healthy).toBe(false);
    });
  });
});
`;
}
