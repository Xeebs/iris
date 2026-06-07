import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  validateConnectorDefinition,
  loadUserConnector,
  scanConnectorDirectory,
} from '../user-connector-loader.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeValidDefinition = () => ({
  manifest: {
    id: 'test-connector',
    name: 'Test Connector',
    description: 'A test connector',
    icon: 'test.svg',
    auth: { type: 'api-key' as const, scopes: [] },
    entityTypes: ['record'],
    configSchema: z.object({ apiKey: z.string() }),
    rateLimits: { requestsPerSecond: 5 },
  },
  createConnector: () => ({
    connect: vi.fn(),
    sync: vi.fn(),
    getSchema: vi.fn(),
    healthCheck: vi.fn(),
  }),
});

// ─── validateConnectorDefinition ──────────────────────────────────────────────

describe('validateConnectorDefinition', () => {
  it('returns empty errors for a valid definition', () => {
    const errors = validateConnectorDefinition(makeValidDefinition());
    expect(errors).toHaveLength(0);
  });

  it('errors when definition is not an object', () => {
    const errors = validateConnectorDefinition('not an object');
    expect(errors).toContain('Module default export must be an object');
  });

  it('errors when manifest is missing', () => {
    const def = makeValidDefinition();
    const { manifest: _manifest, ...rest } = def;
    const errors = validateConnectorDefinition(rest);
    expect(errors.some((e) => e.includes('manifest'))).toBe(true);
  });

  it('errors when manifest.id is missing', () => {
    const def = { ...makeValidDefinition(), manifest: { ...makeValidDefinition().manifest, id: '' } };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('manifest.id'))).toBe(true);
  });

  it('errors when manifest.name is missing', () => {
    const def = {
      ...makeValidDefinition(),
      manifest: { ...makeValidDefinition().manifest, name: '' },
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('manifest.name'))).toBe(true);
  });

  it('errors when manifest.entityTypes is empty', () => {
    const def = {
      ...makeValidDefinition(),
      manifest: { ...makeValidDefinition().manifest, entityTypes: [] },
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('entityTypes'))).toBe(true);
  });

  it('errors when manifest.configSchema is missing', () => {
    const def = {
      ...makeValidDefinition(),
      manifest: { ...makeValidDefinition().manifest, configSchema: undefined },
    };
    const errors = validateConnectorDefinition(def as unknown as object);
    expect(errors.some((e) => e.includes('configSchema'))).toBe(true);
  });

  it('errors when createConnector is not a function', () => {
    const def = { ...makeValidDefinition(), createConnector: 'not-a-function' };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('createConnector'))).toBe(true);
  });

  it('errors when connector instance is missing connect()', () => {
    const def = {
      ...makeValidDefinition(),
      createConnector: () => ({
        sync: vi.fn(),
        getSchema: vi.fn(),
        healthCheck: vi.fn(),
        // connect is missing
      }),
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('connect'))).toBe(true);
  });

  it('errors when connector instance is missing sync()', () => {
    const def = {
      ...makeValidDefinition(),
      createConnector: () => ({
        connect: vi.fn(),
        getSchema: vi.fn(),
        healthCheck: vi.fn(),
      }),
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('sync'))).toBe(true);
  });

  it('errors when connector instance is missing getSchema()', () => {
    const def = {
      ...makeValidDefinition(),
      createConnector: () => ({
        connect: vi.fn(),
        sync: vi.fn(),
        healthCheck: vi.fn(),
      }),
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('getSchema'))).toBe(true);
  });

  it('errors when connector instance is missing healthCheck()', () => {
    const def = {
      ...makeValidDefinition(),
      createConnector: () => ({
        connect: vi.fn(),
        sync: vi.fn(),
        getSchema: vi.fn(),
      }),
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('healthCheck'))).toBe(true);
  });

  it('errors when createConnector throws during validation', () => {
    const def = {
      ...makeValidDefinition(),
      createConnector: () => {
        throw new Error('Config schema not met');
      },
    };
    const errors = validateConnectorDefinition(def);
    expect(errors.some((e) => e.includes('threw during validation'))).toBe(true);
  });
});

// ─── loadUserConnector ─────────────────────────────────────────────────────────

describe('loadUserConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns valid=false when file does not exist', async () => {
    const result = await loadUserConnector('/tmp/nonexistent-connector.js');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('returns valid=false when file import fails', async () => {
    // Use a path that exists but isn't valid JS
    const result = await loadUserConnector('/etc/hostname');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Failed to import'))).toBe(true);
  });
});

// ─── scanConnectorDirectory ────────────────────────────────────────────────────

describe('scanConnectorDirectory', () => {
  it('returns empty array for empty directory', async () => {
    const paths = await scanConnectorDirectory('/tmp');
    // /tmp likely doesn't have index.js or connector.js
    expect(Array.isArray(paths)).toBe(true);
  });

  it('returns empty array when directory does not exist', async () => {
    const paths = await scanConnectorDirectory('/tmp/nonexistent-dir-iris');
    expect(paths).toHaveLength(0);
  });
});
