import { describe, it, expect } from 'vitest';
import {
  parseOperation,
  hashGraphQLQuery,
  mergeVariables,
  estimateResponseTokens,
  buildErrorResponse,
  getSchemaSDL,
} from '../graphql-schema.js';

describe('parseOperation', () => {
  it('parses a simple query operation', () => {
    const op = parseOperation('query { entities(workspaceId: "ws-1") { id label } }');
    expect(op).not.toBeNull();
    expect(op!.type).toBe('query');
    expect(op!.rootField).toBe('entities');
    expect(op!.operationName).toBeNull();
  });

  it('parses a named query operation', () => {
    const op = parseOperation('query GetEntities { entities(workspaceId: "ws-1") { id } }');
    expect(op).not.toBeNull();
    expect(op!.operationName).toBe('GetEntities');
    expect(op!.type).toBe('query');
  });

  it('parses a mutation operation', () => {
    const op = parseOperation('mutation { createEntity(input: { type: "contact" }) { success } }');
    expect(op).not.toBeNull();
    expect(op!.type).toBe('mutation');
    expect(op!.rootField).toBe('createEntity');
  });

  it('parses a subscription operation', () => {
    const op = parseOperation('subscription { onEntityChanged(workspaceId: "ws-1") { id } }');
    expect(op).not.toBeNull();
    expect(op!.type).toBe('subscription');
    expect(op!.rootField).toBe('onEntityChanged');
  });

  it('defaults to query when no operation keyword', () => {
    const op = parseOperation('{ glossary(workspaceId: "ws-1") { term } }');
    expect(op).not.toBeNull();
    expect(op!.type).toBe('query');
    expect(op!.rootField).toBe('glossary');
  });

  it('extracts string args', () => {
    const op = parseOperation('query { entity(id: "ent-1", workspaceId: "ws-1") { label } }');
    expect(op).not.toBeNull();
    expect(op!.args['id']).toBe('ent-1');
    expect(op!.args['workspaceId']).toBe('ws-1');
  });

  it('extracts numeric args', () => {
    const op = parseOperation('query { lineage(entityId: "ent-1", depth: 3) { depth } }');
    expect(op).not.toBeNull();
    expect(op!.args['depth']).toBe(3);
  });

  it('extracts boolean args', () => {
    const op = parseOperation('query { entities(filter: { limit: 10 }) { truncated } }');
    expect(op).not.toBeNull();
  });

  it('marks variable references with $var', () => {
    const op = parseOperation('query ($id: ID!) { entity(id: $id) { label } }');
    expect(op).not.toBeNull();
    expect(op!.args['id']).toEqual({ $var: 'id' });
  });

  it('returns null for completely unparseable input', () => {
    const op = parseOperation('not a graphql query at all!@#');
    expect(op).toBeNull();
  });

  it('handles multi-line whitespace normalization', () => {
    const op = parseOperation(`
      query  GetMetrics  {
        metrics(workspaceId:  "ws-1")  {
          name
          value
        }
      }
    `);
    expect(op).not.toBeNull();
    expect(op!.rootField).toBe('metrics');
  });
});

describe('hashGraphQLQuery', () => {
  it('produces deterministic 8-char hex strings', () => {
    const h1 = hashGraphQLQuery('{ entities { id } }');
    const h2 = hashGraphQLQuery('{ entities { id } }');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces different hashes for different queries', () => {
    const h1 = hashGraphQLQuery('{ entities { id } }');
    const h2 = hashGraphQLQuery('{ metrics { name } }');
    expect(h1).not.toBe(h2);
  });

  it('normalizes whitespace before hashing', () => {
    const h1 = hashGraphQLQuery('{   entities   {   id   }   }');
    const h2 = hashGraphQLQuery('{ entities { id } }');
    expect(h1).toBe(h2);
  });
});

describe('mergeVariables', () => {
  it('substitutes $var references with runtime variable values', () => {
    const op = parseOperation('query ($id: ID!) { entity(id: $id) { label } }')!;
    const merged = mergeVariables(op, { id: 'ent-42' });
    expect(merged['id']).toBe('ent-42');
  });

  it('preserves inline literal args when no variable override', () => {
    const op = parseOperation('query { entity(id: "literal-id") { label } }')!;
    const merged = mergeVariables(op, {});
    expect(merged['id']).toBe('literal-id');
  });

  it('includes extra variables not referenced in args', () => {
    const op = parseOperation('query { glossary { term } }')!;
    const merged = mergeVariables(op, { extraKey: 'extraVal' });
    expect(merged['extraKey']).toBe('extraVal');
  });
});

describe('estimateResponseTokens', () => {
  it('returns non-zero estimate for non-empty data', () => {
    const tokens = estimateResponseTokens({ entities: [{ id: 'e1', label: 'Contact A' }] });
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns 0 for empty object', () => {
    expect(estimateResponseTokens({})).toBe(1); // "{}" = 2 chars / 4 = 0.5 → ceil = 1
  });

  it('scales with data size', () => {
    const small = estimateResponseTokens({ a: 1 });
    const large = estimateResponseTokens({ entities: Array.from({ length: 100 }, (_, i) => ({ id: i, label: `Entity ${i}` })) });
    expect(large).toBeGreaterThan(small);
  });
});

describe('buildErrorResponse', () => {
  it('returns a GraphQL error envelope', () => {
    const resp = buildErrorResponse('Something broke');
    expect(resp.errors).toHaveLength(1);
    expect(resp.errors![0]!.message).toBe('Something broke');
    expect(resp.data).toBeUndefined();
  });
});

describe('getSchemaSDL', () => {
  it('returns non-empty SDL string', () => {
    const sdl = getSchemaSDL();
    expect(typeof sdl).toBe('string');
    expect(sdl.length).toBeGreaterThan(100);
  });

  it('includes all root types', () => {
    const sdl = getSchemaSDL();
    expect(sdl).toContain('type Query');
    expect(sdl).toContain('type Mutation');
    expect(sdl).toContain('type Subscription');
  });

  it('defines core entity types', () => {
    const sdl = getSchemaSDL();
    expect(sdl).toContain('type Entity');
    expect(sdl).toContain('type Metric');
    expect(sdl).toContain('type GlossaryTerm');
  });
});
