import { describe, it, expect } from 'vitest';
import { SdkCodeGenerator } from '../sdk-generator.js';
import type { ToolSchema } from '../sdk-generator.js';

vi.mock('@iris/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { vi } from 'vitest';

const SAMPLE_TOOL: ToolSchema = {
  name: 'query-context',
  description: 'Query semantic context.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
      includeHidden: { type: 'boolean' },
    },
    required: ['query'],
  },
};

const SEARCH_TOOL: ToolSchema = {
  name: 'search-entities',
  description: 'Search entities by semantic similarity.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      threshold: { type: 'number' },
    },
    required: ['query', 'threshold'],
  },
};

// ─── parseToolSchema ──────────────────────────────────────────────────────────

describe('SdkCodeGenerator.parseToolSchema', () => {
  const gen = new SdkCodeGenerator();

  it('extracts name correctly', () => {
    const schema = gen.parseToolSchema({ name: 'my-tool', description: 'desc', inputSchema: {} });
    expect(schema.name).toBe('my-tool');
  });

  it('extracts description', () => {
    const schema = gen.parseToolSchema({ name: 'tool', description: 'My description', inputSchema: {} });
    expect(schema.description).toBe('My description');
  });

  it('extracts inputSchema', () => {
    const schema = gen.parseToolSchema({ name: 'tool', description: '', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } });
    expect(schema.inputSchema).toHaveProperty('properties');
  });

  it('defaults name to "unknown-tool" when missing', () => {
    const schema = gen.parseToolSchema({ description: 'desc', inputSchema: {} });
    expect(schema.name).toBe('unknown-tool');
  });
});

// ─── generateTypeDefinitions ──────────────────────────────────────────────────

describe('SdkCodeGenerator.generateTypeDefinitions', () => {
  const gen = new SdkCodeGenerator();

  it('generates TypeScript types containing z.object', () => {
    const def = gen.generateTypeDefinitions(SAMPLE_TOOL, 'typescript');
    expect(def.typeCode).toContain('z.object');
    expect(def.requestType).toBe('QueryContextRequest');
  });

  it('generates Python types with BaseModel', () => {
    const def = gen.generateTypeDefinitions(SAMPLE_TOOL, 'python');
    expect(def.typeCode).toContain('BaseModel');
    expect(def.requestType).toBe('QueryContextRequest');
  });

  it('generates Go types as struct', () => {
    const def = gen.generateTypeDefinitions(SAMPLE_TOOL, 'go');
    expect(def.typeCode).toContain('struct');
    expect(def.requestType).toBe('QueryContextRequest');
  });

  it('sets responseType correctly', () => {
    const def = gen.generateTypeDefinitions(SAMPLE_TOOL, 'typescript');
    expect(def.responseType).toBe('QueryContextResponse');
  });

  it('marks optional fields with .optional() in TypeScript', () => {
    const def = gen.generateTypeDefinitions(SAMPLE_TOOL, 'typescript');
    expect(def.typeCode).toContain('.optional()');
  });
});

// ─── generateClientLibrary ────────────────────────────────────────────────────

describe('SdkCodeGenerator.generateClientLibrary', () => {
  const gen = new SdkCodeGenerator();

  it('generates TypeScript client with class definition', () => {
    const lib = gen.generateClientLibrary([SAMPLE_TOOL], 'typescript');
    expect(lib.code).toContain('class IrisClient');
    expect(lib.className).toBe('IrisClient');
  });

  it('generates Python client with class definition', () => {
    const lib = gen.generateClientLibrary([SAMPLE_TOOL], 'python');
    expect(lib.code).toContain('class IrisClient');
  });

  it('generates Go client with struct definition', () => {
    const lib = gen.generateClientLibrary([SAMPLE_TOOL], 'go');
    expect(lib.code).toContain('type IrisClient struct');
  });

  it('lists methods correctly', () => {
    const lib = gen.generateClientLibrary([SAMPLE_TOOL, SEARCH_TOOL], 'typescript');
    expect(lib.methods).toContain('queryContext');
    expect(lib.methods).toContain('searchEntities');
  });

  it('includes version in generated code', () => {
    const lib = gen.generateClientLibrary([SAMPLE_TOOL], 'typescript', '1.2.3');
    expect(lib.code).toContain('1.2.3');
    expect(lib.version).toBe('1.2.3');
  });

  it('throws when given empty tools array', () => {
    expect(() => gen.generateClientLibrary([], 'typescript')).toThrow();
  });
});

// ─── outputDocs ───────────────────────────────────────────────────────────────

describe('SdkCodeGenerator.outputDocs', () => {
  const gen = new SdkCodeGenerator();

  it('generates markdown with method sections', () => {
    const docs = gen.outputDocs([SAMPLE_TOOL]);
    expect(docs.markdown).toContain('queryContext');
  });

  it('includes error codes', () => {
    const docs = gen.outputDocs([SAMPLE_TOOL]);
    expect(docs.methods[0]!.errorCodes).toContain('VALIDATION_ERROR');
  });

  it('includes method description', () => {
    const docs = gen.outputDocs([SAMPLE_TOOL]);
    expect(docs.methods[0]!.description).toBe('Query semantic context.');
  });

  it('generates example code', () => {
    const docs = gen.outputDocs([SAMPLE_TOOL]);
    expect(docs.methods[0]!.example).toContain('queryContext');
  });

  it('returns one method entry per tool', () => {
    const docs = gen.outputDocs([SAMPLE_TOOL, SEARCH_TOOL]);
    expect(docs.methods).toHaveLength(2);
  });
});
