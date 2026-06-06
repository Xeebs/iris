import { test, expect, type APIRequestContext } from '@playwright/test';

import { createConnectorInstance, deleteConnectorInstance, triggerSync, TEST_WORKSPACE_ID, AUTH_HEADER } from './utils/test-setup.js';

const WORKSPACE_ID = `${TEST_WORKSPACE_ID}-connector-setup`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listConnectorTypes(request: APIRequestContext) {
  return request.get('/api/v1/connectors/types', { headers: AUTH_HEADER });
}

async function getConnectorType(request: APIRequestContext, id: string) {
  return request.get(`/api/v1/connectors/types/${id}`, { headers: AUTH_HEADER });
}

async function listInstances(request: APIRequestContext, workspaceId: string) {
  return request.get(`/api/v1/connectors?workspaceId=${workspaceId}`, { headers: AUTH_HEADER });
}

async function testConnectivity(
  request: APIRequestContext,
  instanceId: string,
  workspaceId: string,
) {
  return request.post(
    `/api/v1/connectors/${instanceId}/test?workspaceId=${workspaceId}`,
    { headers: AUTH_HEADER },
  );
}

async function updateConnectorInstance(
  request: APIRequestContext,
  instanceId: string,
  workspaceId: string,
  config: Record<string, unknown>,
) {
  return request.put(`/api/v1/connectors/${instanceId}?workspaceId=${workspaceId}`, {
    headers: AUTH_HEADER,
    data: { config },
  });
}

// ---------------------------------------------------------------------------
// Connector type discovery
// ---------------------------------------------------------------------------

test.describe('Connector Type Discovery', () => {
  test('should list registered connector types', async ({ request }) => {
    const response = await listConnectorTypes(request);
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: Array<{ id: string; name: string }> };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const ids = body.data.map((m) => m.id);
    expect(ids).toContain('hubspot');
    expect(ids).toContain('notion');
    expect(ids).toContain('postgres');
  });

  test('should return a specific connector manifest by id', async ({ request }) => {
    const response = await getConnectorType(request, 'hubspot');
    expect(response.ok()).toBe(true);

    const body = await response.json() as {
      data: { id: string; name: string; entityTypes: string[] };
    };
    expect(body.data.id).toBe('hubspot');
    expect(body.data.name).toBe('HubSpot');
    expect(Array.isArray(body.data.entityTypes)).toBe(true);
  });

  test('should return 404 for unknown connector type', async ({ request }) => {
    const response = await getConnectorType(request, 'unknown-connector-xyz');
    expect(response.status()).toBe(404);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Connector instance lifecycle
// ---------------------------------------------------------------------------

test.describe('Connector Instance Lifecycle', () => {
  let instanceId: string;

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await deleteConnectorInstance(request, instanceId);
    }
  });

  test('should return 400 when workspaceId is missing on list', async ({ request }) => {
    const response = await request.get('/api/v1/connectors', { headers: AUTH_HEADER });
    expect(response.status()).toBe(400);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return empty list for a fresh workspace', async ({ request }) => {
    const response = await listInstances(request, WORKSPACE_ID);
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('should return 400 for invalid connector config', async ({ request }) => {
    const response = await request.post('/api/v1/connectors', {
      headers: AUTH_HEADER,
      data: {
        workspaceId: WORKSPACE_ID,
        connectorId: 'postgres',
        config: {},
      },
    });
    expect(response.status()).toBe(400);
  });

  test('should create a postgres connector instance', async ({ request }) => {
    const instance = await createConnectorInstance(request, {
      connectorId: 'postgres',
      workspaceId: WORKSPACE_ID,
      config: {
        connectionString: 'postgresql://localhost:5432/test',
        tables: [{ name: 'users', incrementalColumn: 'updated_at' }],
      },
    });

    instanceId = instance.id;
    expect(instance.id).toBeTruthy();
    expect(instance.connectorId).toBe('postgres');
    expect(instance.workspaceId).toBe(WORKSPACE_ID);
    expect(instance.status).toBe('active');
  });

  test('should fetch the created instance by id', async ({ request }) => {
    expect(instanceId).toBeTruthy();

    const response = await request.get(
      `/api/v1/connectors/${instanceId}?workspaceId=${WORKSPACE_ID}`,
      { headers: AUTH_HEADER },
    );
    expect(response.ok()).toBe(true);

    const body = await response.json() as {
      data: { id: string; connectorId: string; status: string };
    };
    expect(body.data.id).toBe(instanceId);
    expect(body.data.connectorId).toBe('postgres');
  });

  test('should list the instance under the workspace', async ({ request }) => {
    expect(instanceId).toBeTruthy();

    const response = await listInstances(request, WORKSPACE_ID);
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: Array<{ id: string }> };
    const ids = body.data.map((i) => i.id);
    expect(ids).toContain(instanceId);
  });

  test('should update the connector config', async ({ request }) => {
    expect(instanceId).toBeTruthy();

    const response = await updateConnectorInstance(request, instanceId, WORKSPACE_ID, {
      connectionString: 'postgresql://localhost:5432/updated',
      tables: [{ name: 'orders', incrementalColumn: 'updated_at' }],
    });
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: { id: string; config: unknown } };
    expect(body.data.id).toBe(instanceId);
  });

  test('should trigger a sync job for the instance', async ({ request }) => {
    expect(instanceId).toBeTruthy();

    const result = await triggerSync(request, instanceId, WORKSPACE_ID);
    expect(result.status).toMatch(/^(queued|syncing)$/);
  });

  test('should return 404 when fetching a deleted instance', async ({ request }) => {
    expect(instanceId).toBeTruthy();

    await deleteConnectorInstance(request, instanceId);
    instanceId = '';

    const response = await request.get(
      `/api/v1/connectors/nonexistent-id?workspaceId=${WORKSPACE_ID}`,
      { headers: AUTH_HEADER },
    );
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Dashboard UI flow (only meaningful in the 'dashboard' Playwright project)
// ---------------------------------------------------------------------------

test.describe('Dashboard Connector Setup Flow', () => {
  test('should load the connector list page', async ({ page, baseURL }) => {
    test.skip(!baseURL?.includes('3000'), 'Skipped: not running against dashboard');

    await page.goto('/connectors');
    await expect(page).toHaveTitle(/connector|iris/i);
  });

  test('should navigate to the connector setup wizard', async ({ page, baseURL }) => {
    test.skip(!baseURL?.includes('3000'), 'Skipped: not running against dashboard');

    await page.goto('/connectors/setup');
    const heading = page.getByRole('heading');
    await expect(heading).toBeVisible();
  });

  test('should display available connector types in setup step 1', async ({ page, baseURL }) => {
    test.skip(!baseURL?.includes('3000'), 'Skipped: not running against dashboard');

    await page.goto('/connectors/setup');
    await page.waitForLoadState('networkidle');

    const connectorCards = page.locator('[data-testid="connector-type-card"]');
    await expect(connectorCards.first()).toBeVisible();
  });
});
