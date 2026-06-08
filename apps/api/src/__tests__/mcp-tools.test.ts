import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMcpToolsRoutes } from '../routes/mcp-tools.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/mcp-tool-versioning', () => {
  const mockManager = {
    registerToolVersion: vi.fn(),
    resolveHandler: vi.fn(),
    generateClientSdkStub: vi.fn(),
    deprecateVersion: vi.fn(),
    listVersions: vi.fn(),
    listAllTools: vi.fn(),
    deactivateVersion: vi.fn(),
  };
  return {
    ToolVersionManager: vi.fn(() => mockManager),
    _mockManager: mockManager,
  };
});

import { _mockManager as mockManager } from '@iris/semantic-core/mcp-tool-versioning';

const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createMcpToolsRoutes>[0];

function makeApp() {
  const app = new Hono();
  app.route('/', createMcpToolsRoutes(sqlMock));
  return app;
}

beforeEach(() => { vi.clearAllMocks(); });

const versionFixture = {
  toolName: 'query-context', version: '1.0',
  schemaJson: { type: 'object' }, handlerRef: 'tools/qc.v1',
  isActive: true, createdAt: new Date(),
};

describe('GET /', () => {
  it('lists all tools', async () => {
    mockManager.listAllTools.mockResolvedValueOnce(ok([
      { toolName: 'query-context', latestVersion: '2.0', totalVersions: 2 },
    ]));
    const res = await makeApp().request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on DB error', async () => {
    mockManager.listAllTools.mockResolvedValueOnce(err(new Error('db error')));
    const res = await makeApp().request('/');
    expect(res.status).toBe(500);
  });
});

describe('GET /:toolName/versions', () => {
  it('returns version list', async () => {
    mockManager.listVersions.mockResolvedValueOnce(ok([{ ...versionFixture, sunsetDate: null, deprecationMessage: null }]));
    const res = await makeApp().request('/query-context/versions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('POST /:toolName/versions', () => {
  it('registers a new version and returns 201', async () => {
    mockManager.registerToolVersion.mockResolvedValueOnce(ok(versionFixture));
    const res = await makeApp().request('/query-context/versions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.0', schemaJson: { type: 'object' }, handlerRef: 'tools/qc.v1' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { version: string } };
    expect(body.data.version).toBe('1.0');
  });

  it('returns 400 for missing handlerRef', async () => {
    const res = await makeApp().request('/query-context/versions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.0', schemaJson: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when manager rejects invalid version', async () => {
    mockManager.registerToolVersion.mockResolvedValueOnce(err(new Error('Version must be MAJOR.MINOR')));
    const res = await makeApp().request('/query-context/versions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'v1', schemaJson: {}, handlerRef: 'ref' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /:toolName/versions/:version/deprecate', () => {
  it('records deprecation and returns 201', async () => {
    const depRecord = { toolName: 'query-context', version: '1.0', sunsetDate: new Date('2026-12-01'), message: 'Use v2', createdAt: new Date() };
    mockManager.deprecateVersion.mockResolvedValueOnce(ok(depRecord));
    const res = await makeApp().request('/query-context/versions/1.0/deprecate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sunsetDate: '2026-12-01T00:00:00.000Z', message: 'Use v2' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 when message is missing', async () => {
    const res = await makeApp().request('/query-context/versions/1.0/deprecate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sunsetDate: '2026-12-01T00:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:toolName/versions/:version', () => {
  it('deactivates a version', async () => {
    mockManager.deactivateVersion.mockResolvedValueOnce(ok(undefined));
    const res = await makeApp().request('/query-context/versions/1.0', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deactivated: boolean } };
    expect(body.data.deactivated).toBe(true);
  });
});

describe('GET /:toolName/resolve', () => {
  it('resolves handler for client version', async () => {
    mockManager.resolveHandler.mockResolvedValueOnce(ok({
      toolName: 'query-context', resolvedVersion: '1.2', isDeprecated: false, sunsetDate: null, deprecationMessage: null,
    }));
    const res = await makeApp().request('/query-context/resolve?clientVersion=1.2');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { resolvedVersion: string } };
    expect(body.data.resolvedVersion).toBe('1.2');
  });

  it('returns 404 when no version found', async () => {
    mockManager.resolveHandler.mockResolvedValueOnce(err(new Error('No active versions found')));
    const res = await makeApp().request('/unknown-tool/resolve');
    expect(res.status).toBe(404);
  });
});

describe('GET /:toolName/sdk-stub', () => {
  it('generates TypeScript stub', async () => {
    mockManager.generateClientSdkStub.mockResolvedValueOnce(ok({
      toolName: 'query-context', version: '1.0', language: 'typescript', code: '// stub code',
    }));
    const res = await makeApp().request('/query-context/sdk-stub?language=typescript');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { code: string } };
    expect(body.data.code).toBe('// stub code');
  });

  it('returns 404 when tool not found', async () => {
    mockManager.generateClientSdkStub.mockResolvedValueOnce(err(new Error('not found')));
    const res = await makeApp().request('/missing-tool/sdk-stub');
    expect(res.status).toBe(404);
  });
});
