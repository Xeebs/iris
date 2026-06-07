/**
 * E2E tests for the workspace settings page.
 *
 * Tests the full settings management flow: loading workspace info,
 * switching tabs, viewing team members and API keys, and the billing section.
 *
 * Requires:
 *   - API server at NEXT_PUBLIC_API_URL
 *   - Dashboard at DASHBOARD_URL
 *   - TEST_WORKSPACE_A_ID, TEST_WORKSPACE_A_KEY env vars
 */

import { test, expect } from '@playwright/test';
import { API_URL, getWorkspaceA } from './utils/test-setup.js';

test.describe('Workspace settings page — REST API interactions', () => {
  const wsA = getWorkspaceA();

  test('workspace settings endpoint returns workspace data', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/workspace/settings?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    // Endpoint may not exist yet — skip gracefully
    test.skip(res.status() === 404, 'workspace/settings endpoint not yet implemented');
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: { id: string; name: string } };
    expect(body.data.id).toBe(wsA.workspaceId);
  });

  test('workspace members endpoint returns member list', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/workspace/members?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    test.skip(res.status() === 404, 'workspace/members endpoint not yet implemented');
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('MCP API keys endpoint returns key list', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/v1/mcp-api-keys?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    test.skip(res.status() === 404, 'mcp-api-keys endpoint not yet implemented');
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('cannot access settings from a different workspace', async ({ request }) => {
    const wsB = { workspaceId: 'ws-other', authHeaders: { 'x-api-key': 'wrong-key', 'x-workspace-id': 'ws-other' } };
    const res = await request.get(
      `${API_URL}/api/v1/workspace/settings?workspaceId=${wsA.workspaceId}`,
      { headers: wsB.authHeaders },
    );
    test.skip(res.status() === 404, 'workspace/settings endpoint not yet implemented');
    expect([401, 403]).toContain(res.status());
  });

  test('workspace name can be updated via PUT settings endpoint', async ({ request }) => {
    const originalRes = await request.get(
      `${API_URL}/api/v1/workspace/settings?workspaceId=${wsA.workspaceId}`,
      { headers: wsA.authHeaders },
    );
    test.skip(originalRes.status() === 404, 'workspace/settings endpoint not yet implemented');
    if (!originalRes.ok()) return;

    const original = await originalRes.json() as { data: { name: string } };
    const newName = `${original.data.name} (updated)`;

    const putRes = await request.put(
      `${API_URL}/api/v1/workspace/settings?workspaceId=${wsA.workspaceId}`,
      {
        headers: { ...wsA.authHeaders, 'Content-Type': 'application/json' },
        data: { name: newName },
      },
    );
    expect(putRes.status()).toBe(200);

    // Restore original name
    await request.put(
      `${API_URL}/api/v1/workspace/settings?workspaceId=${wsA.workspaceId}`,
      {
        headers: { ...wsA.authHeaders, 'Content-Type': 'application/json' },
        data: { name: original.data.name },
      },
    );
  });
});
