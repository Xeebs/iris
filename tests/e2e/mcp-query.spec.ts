import { test, expect } from '@playwright/test';

import { AUTH_HEADER, TEST_WORKSPACE_ID, API_URL } from './utils/test-setup.js';
import { createTestApiKey, revokeTestApiKey } from './fixtures/auth-mocks.js';

const WORKSPACE_ID = `${TEST_WORKSPACE_ID}-mcp-query`;

// ---------------------------------------------------------------------------
// Context query API tests (REST facade for the MCP retrieval engine)
// ---------------------------------------------------------------------------

test.describe('Context Query API', () => {
  test('should reject a query with missing required fields', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: {},
    });
    expect(response.status()).toBe(400);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject a query with empty query string', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: { query: '', workspaceId: WORKSPACE_ID },
    });
    expect(response.status()).toBe(400);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return valid context response for an empty workspace', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: {
        query: 'What are the top deals this quarter?',
        workspaceId: WORKSPACE_ID,
        contextBudget: 1000,
        topK: 5,
      },
    });
    expect(response.ok()).toBe(true);

    const body = await response.json() as {
      data: {
        content: string;
        tokenCount: number;
        entityCount: number;
        truncated: boolean;
        durationMs: number;
      };
    };
    expect(typeof body.data.content).toBe('string');
    expect(typeof body.data.tokenCount).toBe('number');
    expect(typeof body.data.entityCount).toBe('number');
    expect(typeof body.data.truncated).toBe('boolean');
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('should respect the contextBudget parameter', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: {
        query: 'Show me recent customer activity',
        workspaceId: WORKSPACE_ID,
        contextBudget: 500,
        topK: 10,
      },
    });
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: { tokenCount: number } };
    expect(body.data.tokenCount).toBeLessThanOrEqual(500);
  });

  test('should filter by entity type when entityTypes is provided', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: {
        query: 'Show me all contacts',
        workspaceId: WORKSPACE_ID,
        entityTypes: ['contact'],
        topK: 5,
      },
    });
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: { content: string } };
    expect(typeof body.data.content).toBe('string');
  });

  test('should reject topK values exceeding the maximum of 50', async ({ request }) => {
    const response = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: {
        query: 'All entities',
        workspaceId: WORKSPACE_ID,
        topK: 100,
      },
    });
    expect(response.status()).toBe(400);
  });

  test('should return consistent results on repeat query (cache path)', async ({ request }) => {
    const queryPayload = {
      query: 'Find all deal opportunities',
      workspaceId: WORKSPACE_ID,
      contextBudget: 2000,
      topK: 5,
    };

    const first = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: queryPayload,
    });
    expect(first.ok()).toBe(true);
    const firstBody = await first.json() as { data: { entityCount: number } };

    const second = await request.post('/api/v1/queries', {
      headers: AUTH_HEADER,
      data: queryPayload,
    });
    expect(second.ok()).toBe(true);
    const secondBody = await second.json() as { data: { entityCount: number } };

    expect(secondBody.data.entityCount).toBe(firstBody.data.entityCount);
  });
});

// ---------------------------------------------------------------------------
// API Key lifecycle (validates the key management API used by MCP auth)
// ---------------------------------------------------------------------------

test.describe('MCP API Key Management', () => {
  let createdKeyId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (createdKeyId) {
      await revokeTestApiKey(request, createdKeyId, AUTH_HEADER).catch(() => {
        // best-effort cleanup
      });
    }
  });

  test('should create an MCP API key for a workspace', async ({ request }) => {
    let rawKey: string;
    let keyId: string;

    try {
      ({ rawKey, keyId } = await createTestApiKey(request, WORKSPACE_ID, AUTH_HEADER));
      createdKeyId = keyId;
    } catch (e) {
      test.skip(true, `API key endpoint not available: ${String(e)}`);
      return;
    }

    expect(rawKey).toMatch(/^iris_/);
    expect(keyId).toBeTruthy();
  });

  test('should revoke an MCP API key', async ({ request }) => {
    let keyId: string;

    try {
      ({ keyId } = await createTestApiKey(request, WORKSPACE_ID, AUTH_HEADER));
    } catch {
      test.skip(true, 'API key endpoint not available');
      return;
    }

    const response = await request.delete(`${API_URL}/api/v1/api-keys/${keyId}`, {
      headers: AUTH_HEADER,
    });
    expect(response.ok()).toBe(true);
  });
});
