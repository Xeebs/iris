import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolVersionManager } from '../mcp-tool-versioning.js';

const sampleSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'integer', description: 'Max results' },
    includeMetadata: { type: 'boolean' },
  },
  required: ['query'],
};

function makeSql(mockRows: unknown[][] = []) {
  let callIdx = 0;
  return vi.fn(async () => {
    const rows = mockRows[callIdx] ?? [];
    callIdx++;
    return rows;
  });
}

describe('ToolVersionManager', () => {
  describe('registerToolVersion', () => {
    it('returns registered version on success', async () => {
      const row = {
        tool_name: 'query-context',
        version: '1.0',
        schema_json: JSON.stringify(sampleSchema),
        handler_ref: 'tools/query-context.v1',
        is_active: true,
        created_at: new Date('2026-01-01'),
      };
      const sql = makeSql([[row]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.registerToolVersion('query-context', '1.0', sampleSchema, 'tools/query-context.v1');
      expect(result.isOk()).toBe(true);
      const v = result._unsafeUnwrap();
      expect(v.toolName).toBe('query-context');
      expect(v.version).toBe('1.0');
      expect(v.handlerRef).toBe('tools/query-context.v1');
    });

    it('rejects invalid version format', async () => {
      const sql = makeSql([]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.registerToolVersion('query-context', 'v1', sampleSchema, 'ref');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/MAJOR.MINOR/);
    });

    it('returns error when DB throws', async () => {
      const sql = vi.fn(async () => { throw new Error('db error'); });
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.registerToolVersion('query-context', '1.0', sampleSchema, 'ref');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('resolveHandler', () => {
    it('picks highest compatible version for client', async () => {
      const rows = [
        { tool_name: 'query-context', version: '1.2', sunset_date: null, deprecation_message: null },
        { tool_name: 'query-context', version: '1.1', sunset_date: null, deprecation_message: null },
        { tool_name: 'query-context', version: '1.0', sunset_date: null, deprecation_message: null },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.resolveHandler('query-context', '1.2');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().resolvedVersion).toBe('1.2');
    });

    it('does not return incompatible major version', async () => {
      const rows = [
        { tool_name: 'query-context', version: '2.0', sunset_date: null, deprecation_message: null },
        { tool_name: 'query-context', version: '1.0', sunset_date: null, deprecation_message: null },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.resolveHandler('query-context', '1.0');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().resolvedVersion).toBe('1.0');
    });

    it('indicates deprecated version in resolution', async () => {
      const rows = [
        { tool_name: 'query-context', version: '1.0', sunset_date: new Date('2026-12-01'), deprecation_message: 'Use 2.0' },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.resolveHandler('query-context', '1.0');
      expect(result.isOk()).toBe(true);
      const r = result._unsafeUnwrap();
      expect(r.isDeprecated).toBe(true);
      expect(r.deprecationMessage).toBe('Use 2.0');
    });

    it('returns error when no active versions found', async () => {
      const sql = makeSql([[]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.resolveHandler('nonexistent-tool', '1.0');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/No active versions/);
    });

    it('falls back to latest when no exact major match', async () => {
      const rows = [
        { tool_name: 'query-context', version: '2.0', sunset_date: null, deprecation_message: null },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.resolveHandler('query-context', '1.0');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().resolvedVersion).toBe('2.0');
    });
  });

  describe('generateClientSdkStub', () => {
    it('generates TypeScript stub with typed fields', async () => {
      const row = { tool_name: 'query-context', version: '1.0', schema_json: JSON.stringify(sampleSchema) };
      const sql = makeSql([[row]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.generateClientSdkStub('query-context', 'typescript');
      expect(result.isOk()).toBe(true);
      const stub = result._unsafeUnwrap();
      expect(stub.language).toBe('typescript');
      expect(stub.code).toContain('QueryContextInput');
      expect(stub.code).toContain('query: string');
      expect(stub.code).toContain('limit?: number');
    });

    it('generates Python stub', async () => {
      const row = { tool_name: 'query-context', version: '1.0', schema_json: JSON.stringify(sampleSchema) };
      const sql = makeSql([[row]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.generateClientSdkStub('query-context', 'python');
      expect(result.isOk()).toBe(true);
      const stub = result._unsafeUnwrap();
      expect(stub.code).toContain('def query_context');
      expect(stub.code).toContain('query: str');
      expect(stub.code).toContain('limit: int = None');
    });

    it('returns error when tool not found', async () => {
      const sql = makeSql([[]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.generateClientSdkStub('missing-tool', 'typescript');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/not found/);
    });
  });

  describe('deprecateVersion', () => {
    it('records deprecation with sunset date', async () => {
      const row = {
        tool_name: 'query-context', version: '1.0',
        sunset_date: new Date('2026-12-01'), message: 'Use v2', created_at: new Date(),
      };
      const sql = makeSql([[row]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.deprecateVersion('query-context', '1.0', new Date('2026-12-01'), 'Use v2');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().message).toBe('Use v2');
    });

    it('returns error on DB failure', async () => {
      const sql = vi.fn(async () => { throw new Error('constraint violation'); });
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.deprecateVersion('query-context', '1.0', new Date(), 'deprecated');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listVersions', () => {
    it('returns all versions with deprecation info', async () => {
      const rows = [
        { tool_name: 'query-context', version: '2.0', schema_json: '{}', handler_ref: 'v2', is_active: true, created_at: new Date(), sunset_date: null, deprecation_message: null },
        { tool_name: 'query-context', version: '1.0', schema_json: '{}', handler_ref: 'v1', is_active: true, created_at: new Date(), sunset_date: new Date('2026-12-01'), deprecation_message: 'Use v2' },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.listVersions('query-context');
      expect(result.isOk()).toBe(true);
      const versions = result._unsafeUnwrap();
      expect(versions).toHaveLength(2);
      expect(versions[1]?.sunsetDate).toBeDefined();
    });
  });

  describe('listAllTools', () => {
    it('returns tool summary with version counts', async () => {
      const rows = [
        { tool_name: 'query-context', latest_version: '2.0', total_versions: '2' },
        { tool_name: 'list-entities', latest_version: '1.0', total_versions: '1' },
      ];
      const sql = makeSql([rows]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.listAllTools();
      expect(result.isOk()).toBe(true);
      const tools = result._unsafeUnwrap();
      expect(tools).toHaveLength(2);
      expect(tools[0]?.toolName).toBe('query-context');
      expect(tools[0]?.totalVersions).toBe(2);
    });
  });

  describe('deactivateVersion', () => {
    it('deactivates version without error', async () => {
      const sql = makeSql([[]]);
      const manager = new ToolVersionManager(sql as unknown as Parameters<typeof ToolVersionManager>[0]);
      const result = await manager.deactivateVersion('query-context', '1.0');
      expect(result.isOk()).toBe(true);
    });
  });
});
