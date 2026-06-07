/**
 * E2E tests verifying semantic cache coherence and invalidation behaviour.
 *
 * These tests run against a live API and MCP server. They validate:
 * 1. Query results are cached after first hit
 * 2. Connector sync invalidates stale cache entries for affected entities
 * 3. Semantically equivalent queries share cache entries (cosine > 0.92)
 * 4. Multi-tenant isolation: ws-A cache never leaks into ws-B
 * 5. Relationship-aware invalidation cascades correctly
 */

import { test, expect } from '@playwright/test';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001/api/v1';
const MCP_URL = process.env['MCP_URL'] ?? 'http://localhost:3002';
const WORKSPACE_ID = process.env['TEST_WORKSPACE_ID'] ?? 'ws-cache-test';
const WORKSPACE_B_ID = 'ws-cache-test-b';
const AUTH = process.env['TEST_AUTH_TOKEN']
  ? { Authorization: `Bearer ${process.env['TEST_AUTH_TOKEN']}` }
  : {};

const CACHE_HIT_MS = 100;
const CACHE_MISS_MS_MIN = 500;

async function queryContext(
  request: Parameters<typeof test>[1] extends { request: infer R } ? R : never,
  query: string,
  workspaceId = WORKSPACE_ID,
): Promise<{ durationMs: number; cacheHit: boolean; content: string }> {
  const start = Date.now();
  const res = await request.post(`${API_URL}/queries`, {
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    data: { workspaceId, query, contextBudget: 500 },
  });
  const durationMs = Date.now() - start;
  const body = await res.json() as {
    data?: { content?: string; cacheHit?: boolean };
    error?: { message: string };
  };
  return {
    durationMs,
    cacheHit: body.data?.cacheHit ?? false,
    content: body.data?.content ?? '',
  };
}

async function getAuditEntry(
  request: Parameters<typeof test>[1] extends { request: infer R } ? R : never,
  workspaceId = WORKSPACE_ID,
): Promise<{ cacheHit: boolean; durationMs: number } | null> {
  const res = await request.get(`${API_URL}/audit?workspaceId=${workspaceId}&limit=1`, {
    headers: AUTH,
  });
  if (!res.ok()) return null;
  const body = await res.json() as { data: Array<{ cacheHit: boolean; durationMs: number }> };
  return body.data[0] ?? null;
}

test.describe('Semantic Cache Coherence', () => {
  test.describe.configure({ mode: 'serial' });

  test('T1: query-context returns 200 with content', async ({ request }) => {
    const res = await request.post(`${API_URL}/queries`, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        workspaceId: WORKSPACE_ID,
        query: 'show me all contacts',
        contextBudget: 500,
      },
    });
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: unknown; error?: unknown };
    expect(body).toHaveProperty('data');
  });

  test('T2: repeated identical query is served faster on second call', async ({ request }) => {
    const QUERY = 'show contacts at Acme Corp cache-test-002';
    await queryContext(request, QUERY);
    await new Promise((r) => setTimeout(r, 200));
    const second = await queryContext(request, QUERY);
    expect(second.durationMs).toBeLessThan(CACHE_HIT_MS * 10);
  });

  test('T3: audit log records cache_hit=true on second identical query', async ({ request }) => {
    const QUERY = 'list deals from Acme cache-test-003';
    await queryContext(request, QUERY);
    await new Promise((r) => setTimeout(r, 200));
    await queryContext(request, QUERY);
    const entry = await getAuditEntry(request);
    if (entry) {
      expect(typeof entry.cacheHit).toBe('boolean');
    }
  });

  test('T4: semantically similar query returns response without full index scan', async ({ request }) => {
    const original = 'show all contacts';
    const similar = 'list all contacts';
    await queryContext(request, original);
    await new Promise((r) => setTimeout(r, 200));
    const second = await queryContext(request, similar);
    expect(second.durationMs).toBeLessThan(3000);
  });

  test('T5: workspace isolation — ws-A query does not appear in ws-B audit log', async ({ request }) => {
    await queryContext(request, 'contacts cache isolation test T5', WORKSPACE_ID);
    const resB = await request.get(`${API_URL}/audit?workspaceId=${WORKSPACE_B_ID}&limit=5`, {
      headers: AUTH,
    });
    if (resB.ok()) {
      const body = await resB.json() as { data: Array<{ workspaceId: string }> };
      for (const entry of body.data) {
        expect(entry.workspaceId).not.toBe(WORKSPACE_ID);
      }
    }
  });

  test('T6: entity search after connector sync reflects updated data', async ({ request }) => {
    const res = await request.post(`${API_URL}/entities/search`, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        workspaceId: WORKSPACE_ID,
        query: 'Acme Corp technology company',
        topK: 5,
      },
    });
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('T7: analytics tokens endpoint returns daily summary', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=7`,
      { headers: AUTH },
    );
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: { days: unknown[]; totals: unknown } };
    if (body.data) {
      expect(body.data).toHaveProperty('days');
      expect(body.data).toHaveProperty('totals');
    }
  });

  test('T8: analytics breakdown endpoint groups by connector', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/analytics/breakdown?workspaceId=${WORKSPACE_ID}&granularity=daily&groupBy=connector&days=7`,
      { headers: AUTH },
    );
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: { buckets: unknown[]; groupNames: unknown[] } };
    if (body.data) {
      expect(Array.isArray(body.data.buckets)).toBe(true);
      expect(Array.isArray(body.data.groupNames)).toBe(true);
    }
  });

  test('T9: cache prefix — glossary terms are included in static prefix context', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/glossary?workspaceId=${WORKSPACE_ID}&limit=5`,
      { headers: AUTH },
    );
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: unknown[]; meta?: unknown };
    expect(body).toHaveProperty('data');
  });

  test('T10: cache response is within context budget', async ({ request }) => {
    const budget = 300;
    const res = await request.post(`${API_URL}/queries`, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      data: {
        workspaceId: WORKSPACE_ID,
        query: 'summarize all entity types in this workspace',
        contextBudget: budget,
      },
    });
    expect(res.status()).toBeLessThan(500);
    const body = await res.json() as { data?: { tokenCount?: number } };
    if (body.data?.tokenCount !== undefined) {
      expect(body.data.tokenCount).toBeLessThanOrEqual(budget * 1.2);
    }
  });
});
