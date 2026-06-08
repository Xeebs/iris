import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createGraphQLRoutes } from '../routes/graphql.js';
import * as schema from '@iris/semantic-core/graphql-schema';
import * as resolver from '@iris/semantic-core/graphql-resolver';
import { ok } from 'neverthrow';

vi.mock('@iris/semantic-core/graphql-schema');
vi.mock('@iris/semantic-core/graphql-resolver');

const mockSchema = vi.mocked(schema);
const mockResolver = vi.mocked(resolver);

function buildApp() {
  const sql = vi.fn().mockResolvedValue([]);
  const app = new Hono();
  app.route('/graphql', createGraphQLRoutes(sql as never));
  return { app, sql };
}

const MOCK_OP = {
  type: 'query' as const,
  operationName: 'GetEntities',
  rootField: 'entities',
  args: { workspaceId: 'ws-1' },
  selectionSet: ['id', 'label'],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockSchema.getSchemaSDL.mockReturnValue('type Query { entities: [Entity] }');
  mockSchema.buildErrorResponse.mockImplementation((msg: string) => ({ errors: [{ message: msg }] }));
  mockSchema.hashGraphQLQuery.mockReturnValue('abcd1234');
  mockResolver.enforceTokenBudget.mockImplementation((r) => r);
  mockResolver.isAuthorized.mockReturnValue(true);
});

describe('GET /graphql/schema', () => {
  it('returns SDL text', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql/schema');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('type Query');
  });
});

describe('POST /graphql', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ entities { id } }' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unparseable query', async () => {
    mockSchema.parseOperation.mockReturnValue(null);
    const { app } = buildApp();
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ query: 'not valid graphql' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when not authorized', async () => {
    mockSchema.parseOperation.mockReturnValue(MOCK_OP);
    mockResolver.isAuthorized.mockReturnValue(false);
    const { app } = buildApp();
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1', 'x-user-role': 'viewer' },
      body: JSON.stringify({ query: 'mutation { createEntity { success } }' }),
    });
    expect(res.status).toBe(403);
  });

  it('executes query and returns 200', async () => {
    mockSchema.parseOperation.mockReturnValue(MOCK_OP);
    mockResolver.executeOperation.mockResolvedValue(
      ok({ data: { entities: [{ id: 'e1' }] }, extensions: { tokensBudgetUsed: 50 } }),
    );
    const { app } = buildApp();
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ query: '{ entities { id } }', variables: {} }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { entities: unknown[] } };
    expect(body.data.entities).toHaveLength(1);
  });

  it('respects context budget from header', async () => {
    mockSchema.parseOperation.mockReturnValue(MOCK_OP);
    mockResolver.executeOperation.mockResolvedValue(ok({ data: {} }));
    const { app } = buildApp();
    await app.request('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workspace-id': 'ws-1',
        'x-context-budget': '500',
      },
      body: JSON.stringify({ query: '{ entities { id } }' }),
    });
    expect(mockResolver.executeOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contextBudget: 500 }),
      expect.anything(),
    );
  });
});

describe('POST /graphql/batch', () => {
  it('rejects non-array body', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify({ query: '{ entities { id } }' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects batch of more than 10', async () => {
    const { app } = buildApp();
    const ops = Array.from({ length: 11 }, () => ({ query: '{ entities { id } }' }));
    const res = await app.request('/graphql/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify(ops),
    });
    expect(res.status).toBe(400);
  });

  it('executes a valid batch and returns array', async () => {
    mockSchema.parseOperation.mockReturnValue(MOCK_OP);
    mockResolver.executeOperation.mockResolvedValue(ok({ data: { entities: [] } }));
    const { app } = buildApp();
    const ops = [{ query: '{ entities { id } }' }, { query: '{ metrics { name } }' }];
    const res = await app.request('/graphql/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      body: JSON.stringify(ops),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });
});

describe('POST /graphql/hash', () => {
  it('returns query hash', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql/hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ entities { id } }' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { hash: string };
    expect(body.hash).toBe('abcd1234');
  });

  it('returns 400 when no query', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql/hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /graphql/audit', () => {
  it('returns 400 without workspaceId', async () => {
    const { app } = buildApp();
    const res = await app.request('/graphql/audit');
    expect(res.status).toBe(400);
  });

  it('returns audit entries', async () => {
    const { app, sql } = buildApp();
    sql.mockResolvedValue([{ id: 1, query_hash: 'abc', query_cost_tokens: 100, execution_time_ms: 50 }]);
    const res = await app.request('/graphql/audit?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
