import { test, expect } from '@playwright/test';

const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3001';
const API_URL = process.env['PLAYWRIGHT_API_URL'] ?? 'http://localhost:3000';

test.describe('Streaming Context API', () => {
  test('POST /api/v1/context/stream returns SSE response', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/context/stream`, {
      data: { query: 'open deals', tokenBudget: 1000 },
      headers: { 'x-workspace-id': 'e2e-test-ws' },
    });
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/event-stream');
  });

  test('POST /api/v1/context/stream returns 400 for empty query', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/context/stream`, {
      data: { query: '', tokenBudget: 1000 },
      headers: { 'x-workspace-id': 'e2e-test-ws' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/v1/context/stream returns 400 for missing workspace', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/v1/context/stream`, {
      data: { query: 'test', tokenBudget: 1000 },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/v1/context/stream/metrics returns metrics envelope', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/context/stream/metrics`, {
      headers: { 'x-workspace-id': 'e2e-test-ws' },
    });
    expect(res.status()).toBe(200);
    const json = await res.json() as { data: { avgDurationMs: number; totalRequests: number } };
    expect(json.data).toHaveProperty('avgDurationMs');
    expect(json.data).toHaveProperty('totalRequests');
  });
});

test.describe('Context Monitor Dashboard', () => {
  test('context monitor page loads without errors', async ({ page }) => {
    await page.route('**/api/v1/context/stream/metrics', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            avgDurationMs: 245,
            p95DurationMs: 820,
            avgTokensPerRequest: 1340,
            totalRequests: 4820,
            truncationRatePct: 7.2,
          },
        }),
      });
    });

    await page.goto(`${BASE_URL}/context-monitor`);
    await expect(page.getByRole('heading', { name: /context stream monitor/i })).toBeVisible();
    await expect(page.getByText('245')).toBeVisible();
  });

  test('refresh button re-fetches metrics', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/v1/context/stream/metrics', (route) => {
      callCount++;
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { avgDurationMs: 300, p95DurationMs: 900, avgTokensPerRequest: 1500, totalRequests: callCount * 100, truncationRatePct: 5 },
        }),
      });
    });

    await page.goto(`${BASE_URL}/context-monitor`);
    await page.getByRole('button', { name: /refresh/i }).click();
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('live streaming preview panel has stream button', async ({ page }) => {
    await page.route('**/api/v1/context/stream/metrics', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { avgDurationMs: 200, p95DurationMs: 600, avgTokensPerRequest: 1200, totalRequests: 100, truncationRatePct: 3 } }),
      });
    });

    await page.goto(`${BASE_URL}/context-monitor`);
    await expect(page.getByRole('button', { name: /stream/i })).toBeVisible();
  });
});
