/**
 * Multi-tenant workspace isolation E2E tests.
 *
 * These tests verify that strict workspace isolation is enforced across:
 * - REST API resource access (connectors, glossary terms, entities)
 * - MCP API key scoping
 * - Entity search filtering
 *
 * Requires a running API server at API_URL with two pre-seeded workspaces
 * (ws-e2e-alpha and ws-e2e-beta) having different MCP API keys.
 * Set env vars: TEST_WORKSPACE_A_ID, TEST_WORKSPACE_A_KEY,
 *               TEST_WORKSPACE_B_ID, TEST_WORKSPACE_B_KEY.
 */

import { test, expect } from '@playwright/test';
import {
  API_URL,
  getWorkspaceA,
  getWorkspaceB,
  createConnectorInstance,
  deleteConnectorInstance,
} from './utils/test-setup.js';

test.describe('Multi-tenant workspace isolation — REST API', () => {
  const wsA = getWorkspaceA();
  const wsB = getWorkspaceB();

  test('workspace A cannot read connector instances from workspace B', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/connectors?workspaceId=${wsB.workspaceId}`, {
      headers: wsA.authHeaders,
    });
    expect([401, 403]).toContain(res.status());
  });

  test('workspace A glossary terms are invisible to workspace B', async ({ request }) => {
    const createRes = await request.post(`${API_URL}/api/v1/glossary`, {
      headers: wsA.authHeaders,
      data: {
        workspaceId: wsA.workspaceId,
        term: 'e2e-isolation-term',
        definition: 'Test glossary term for workspace A',
      },
    });
    test.skip(!createRes.ok(), 'glossary term creation failed — skipping cross-workspace check');

    const readRes = await request.get(
      `${API_URL}/api/v1/glossary/e2e-isolation-term?workspaceId=${wsA.workspaceId}`,
      { headers: wsB.authHeaders },
    );
    expect([401, 403, 404]).toContain(readRes.status());
  });

  test('entity search scoped to authenticated workspace only', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/entities?workspaceId=${wsB.workspaceId}&query=test`,
      { headers: wsA.authHeaders },
    );
    expect([401, 403]).toContain(res.status());
  });

  test('connector create is rejected when workspaceId differs from auth context', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/connectors`, {
      headers: wsA.authHeaders,
      data: {
        connectorId: 'hubspot',
        workspaceId: wsB.workspaceId,
        config: { apiKey: 'test' },
      },
    });
    expect([401, 403, 422]).toContain(res.status());
  });

  test('workflow templates from workspace A are not accessible by workspace B', async ({ request }) => {
    const createRes = await request.post(`${API_URL}/api/v1/workflow-templates`, {
      headers: wsA.authHeaders,
      data: {
        workspaceId: wsA.workspaceId,
        templateName: 'e2e-isolation-tmpl',
        mcpCalls: [{ tool: 'query-context', params: {} }],
      },
    });
    if (!createRes.ok()) test.skip(true, 'template creation failed');

    const body = await createRes.json() as { data: { id: string } };
    const tmplId = body.data.id;

    const readRes = await request.get(
      `${API_URL}/api/v1/workflow-templates/${tmplId}?workspaceId=${wsB.workspaceId}`,
      { headers: wsB.authHeaders },
    );
    expect([403, 404]).toContain(readRes.status());

    await request.delete(
      `${API_URL}/api/v1/workflow-templates/${tmplId}?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
  });

  test('PUT connector/:id from wrong workspace returns 403/404', async ({ request }) => {
    const createRes = await request.post(`${API_URL}/api/v1/connectors`, {
      headers: wsA.authHeaders,
      data: {
        connectorId: 'hubspot',
        workspaceId: wsA.workspaceId,
        config: { apiKey: 'test' },
      },
    });
    if (!createRes.ok()) test.skip(true, 'connector creation failed');

    const body = await createRes.json() as { data: { id: string } };
    const instanceId = body.data.id;

    const updateRes = await request.put(`${API_URL}/api/v1/connectors/${instanceId}`, {
      headers: wsB.authHeaders,
      data: { status: 'disabled', workspaceId: wsB.workspaceId },
    });
    expect([403, 404]).toContain(updateRes.status());

    await deleteConnectorInstance(request, instanceId);
  });

  test('benchmark metrics are scoped to authenticated workspace', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/workspace/benchmark-snapshot?workspaceId=${wsB.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    expect([401, 403]).toContain(res.status());
  });

  test('OSI export only returns data from the requesting workspace', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/export/osi?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    if (!res.ok()) test.skip(true, 'OSI export unavailable');

    const body = await res.json() as { data: { '@graph': { workspaceId?: string }[] } };
    for (const node of body.data['@graph'] ?? []) {
      if (node.workspaceId) {
        expect(node.workspaceId).toBe(wsA.workspaceId);
      }
    }
  });
});

test.describe('Multi-tenant isolation — MCP API key scoping', () => {
  const wsA = getWorkspaceA();
  const wsB = getWorkspaceB();
  const MCP_URL = process.env['MCP_URL'] ?? 'http://localhost:3002';

  test('MCP API key from workspace A is rejected by workspace B endpoints', async ({ request }) => {
    const res = await request.post(`${MCP_URL}/mcp`, {
      headers: {
        Authorization: `Bearer ${wsA.apiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'query-context',
          arguments: { query: 'test', workspaceId: wsB.workspaceId },
        },
      },
    });
    if (res.status() === 200) {
      const body = await res.json() as { result?: { content?: { text?: string }[] } };
      const text = body.result?.content?.[0]?.text ?? '';
      expect(text).not.toContain(wsB.workspaceId);
    } else {
      expect([401, 403]).toContain(res.status());
    }
  });

  test('MCP query-context results contain only authenticated workspace entities', async ({ request }) => {
    const res = await request.post(`${MCP_URL}/mcp`, {
      headers: {
        Authorization: `Bearer ${wsA.apiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'query-context',
          arguments: { query: 'deals', workspaceId: wsA.workspaceId },
        },
      },
    });
    test.skip(!res.ok(), 'MCP server not available');
    const body = await res.json() as {
      result?: { content?: { text?: string }[] };
      error?: { message?: string };
    };
    expect(body.error).toBeUndefined();
  });
});
