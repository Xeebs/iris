import { test, expect } from '@playwright/test';

test.describe('Admin Console', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/workspaces*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'ws-1',
              name: 'Acme Corp',
              created_at: new Date().toISOString(),
              connector_count: 3,
              mcp_query_volume: 245,
              last_mcp_query_at: new Date().toISOString(),
              last_sync_at: new Date().toISOString(),
            },
          ],
          meta: { hasMore: false, nextCursor: null },
        }),
      }),
    );
    await page.route('**/api/v1/admin/system-health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            status: 'ok',
            checks: {
              postgres: { status: 'ok', latencyMs: 5 },
              data: { status: 'ok', message: '1 workspaces, 3 connectors' },
            },
            timestamp: new Date().toISOString(),
          },
        }),
      }),
    );
    await page.route('**/api/v1/admin/errors*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { errors: [], summary: [], periodDays: 7 },
        }),
      }),
    );
  });

  test('renders admin console page with tabs', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Admin Console')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'System Health' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Error Analysis' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Config Inspector' })).toBeVisible();
  });

  test('shows workspace list in Workspaces tab', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('3 connectors')).toBeVisible();
  });

  test('shows system health in System Health tab', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'System Health' }).click();
    await expect(page.getByText('Overall:')).toBeVisible();
    await expect(page.getByText('Healthy')).toBeVisible();
    await expect(page.getByText('postgres', { exact: false })).toBeVisible();
  });

  test('shows no errors message in Error Analysis tab', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Error Analysis' }).click();
    await expect(page.getByText('No sync failures in the last 7 days.')).toBeVisible();
  });

  test('shows config inspector in Config tab', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Config Inspector' }).click();
    await expect(page.getByText('Rate Limits')).toBeVisible();
    await expect(page.getByText('100 / min')).toBeVisible();
  });

  test('refresh button re-fetches data', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/v1/admin/workspaces*', (route) => {
      callCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { hasMore: false } }),
      });
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Refresh' }).click();

    expect(callCount).toBeGreaterThan(1);
  });

  test('shows 403 admin error when not admin', async ({ page }) => {
    await page.route('**/api/v1/admin/workspaces*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }),
      }),
    );

    await page.goto('/admin');
    await expect(page.getByText('Admin access required')).toBeVisible();
  });
});
