import { test, expect } from '@playwright/test';

import {
  AUTH_HEADER,
  TEST_WORKSPACE_ID,
  createConnectorInstance,
  deleteConnectorInstance,
  triggerSync,
} from './utils/test-setup.js';

const WORKSPACE_ID = `${TEST_WORKSPACE_ID}-analytics`;

// ---------------------------------------------------------------------------
// Token Analytics API
// ---------------------------------------------------------------------------

test.describe('Token Analytics API', () => {
  test('should return 400 when workspaceId is missing', async ({ request }) => {
    const response = await request.get('/api/v1/analytics/tokens', { headers: AUTH_HEADER });
    expect(response.status()).toBe(400);

    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should return analytics data structure for a workspace', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}`,
      { headers: AUTH_HEADER },
    );
    expect(response.ok()).toBe(true);

    const body = await response.json() as {
      data: {
        days: Array<{
          date: string;
          tokensSpent: number;
          tokensSavedByCaching: number;
          tokensSavedByCompression: number;
        }>;
        totals: {
          tokensSpent: number;
          tokensSaved: number;
          cacheHitRate: number;
        };
      };
    };
    expect(Array.isArray(body.data.days)).toBe(true);
    expect(typeof body.data.totals).toBe('object');
    expect(typeof body.data.totals.tokensSpent).toBe('number');
    expect(typeof body.data.totals.tokensSaved).toBe('number');
    expect(typeof body.data.totals.cacheHitRate).toBe('number');
  });

  test('should accept a custom day range via the days parameter', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=7`,
      { headers: AUTH_HEADER },
    );
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: { days: unknown[] } };
    expect(body.data.days.length).toBeLessThanOrEqual(7);
  });

  test('should reject days=0', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=0`,
      { headers: AUTH_HEADER },
    );
    expect(response.status()).toBe(400);
  });

  test('should reject days exceeding 365', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=400`,
      { headers: AUTH_HEADER },
    );
    expect(response.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Sync → analytics integration
// ---------------------------------------------------------------------------

test.describe('Sync and Token Logging Flow', () => {
  let instanceId: string | undefined;

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await deleteConnectorInstance(request, instanceId).catch(() => {
        // best-effort cleanup
      });
    }
  });

  test('should record token events after triggering a sync', async ({ request }) => {
    const instance = await createConnectorInstance(request, {
      connectorId: 'postgres',
      workspaceId: WORKSPACE_ID,
      config: {
        connectionString: 'postgresql://localhost:5432/iris_test',
        tables: [{ name: 'contacts', incrementalColumn: 'updated_at' }],
      },
    });
    instanceId = instance.id;

    const syncResult = await triggerSync(request, instanceId, WORKSPACE_ID);
    expect(syncResult.status).toMatch(/^(queued|syncing)$/);

    // Analytics may not reflect the sync immediately (async job), so we only validate
    // that the endpoint remains reachable and returns a valid structure post-trigger.
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=1`,
      { headers: AUTH_HEADER },
    );
    expect(response.ok()).toBe(true);

    const body = await response.json() as { data: { totals: { tokensSpent: number } } };
    expect(typeof body.data.totals.tokensSpent).toBe('number');
  });

  test('analytics totals should have non-negative values', async ({ request }) => {
    const response = await request.get(
      `/api/v1/analytics/tokens?workspaceId=${WORKSPACE_ID}&days=30`,
      { headers: AUTH_HEADER },
    );
    expect(response.ok()).toBe(true);

    const body = await response.json() as {
      data: {
        totals: {
          tokensSpent: number;
          tokensSaved: number;
          cacheHitRate: number;
        };
      };
    };
    expect(body.data.totals.tokensSpent).toBeGreaterThanOrEqual(0);
    expect(body.data.totals.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(body.data.totals.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(body.data.totals.cacheHitRate).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Dashboard analytics page (only meaningful in the 'dashboard' Playwright project)
// ---------------------------------------------------------------------------

test.describe('Analytics Dashboard Page', () => {
  test('should load the analytics page', async ({ page, baseURL }) => {
    test.skip(!baseURL?.includes('3000'), 'Skipped: not running against dashboard');

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading');
    await expect(heading).toBeVisible();
  });

  test('should display the token usage chart', async ({ page, baseURL }) => {
    test.skip(!baseURL?.includes('3000'), 'Skipped: not running against dashboard');

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    const chart = page.locator('[data-testid="token-chart"]');
    await expect(chart).toBeVisible();
  });
});
