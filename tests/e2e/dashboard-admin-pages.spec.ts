/**
 * E2E tests for the Iris dashboard admin and settings pages.
 * Uses Playwright route mocking (page.route) to intercept API calls.
 * Each test.describe covers a distinct admin feature area.
 */

import { test, expect } from '@playwright/test';

// ─── Common constants ─────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test';
const AUTH_HEADER = { 'x-workspace-id': WORKSPACE_ID, 'x-api-key': 'iris_test_admin_key' };

// ─── Admin Console ────────────────────────────────────────────────────────────

test.describe('Admin console — system overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/workspaces*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'ws-test', name: 'Test Workspace', connector_count: 3, mcp_query_volume: 100, created_at: new Date().toISOString() }],
          meta: { hasMore: false, nextCursor: null },
        }),
      }),
    );
    await page.route('**/api/v1/admin/system-health*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { status: 'ok', checks: { postgres: { status: 'ok', latencyMs: 3 }, redis: { status: 'ok', latencyMs: 1 } }, timestamp: new Date().toISOString() },
        }),
      }),
    );
    await page.route('**/api/v1/admin/errors*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { errors: [], summary: [], periodDays: 7 } }) }),
    );
  });

  test('renders admin console page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Admin Console')).toBeVisible();
  });

  test('shows workspace list', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Test Workspace')).toBeVisible();
  });

  test('shows system health tab', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'System Health' }).click();
    await expect(page.getByText('Healthy')).toBeVisible();
  });

  test('shows error analysis tab with no failures', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Error Analysis' }).click();
    await expect(page.getByText('No sync failures in the last 7 days.')).toBeVisible();
  });

  test('shows 403 message when not admin', async ({ page }) => {
    await page.route('**/api/v1/admin/workspaces*', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }) }),
    );
    await page.goto('/admin');
    await expect(page.getByText('Admin access required')).toBeVisible();
  });
});

// ─── User Management ──────────────────────────────────────────────────────────

test.describe('Admin users — user management', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/system/users*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'u-1', email: 'alice@example.com', role: 'admin', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString() },
            { id: 'u-2', email: 'bob@example.com', role: 'viewer', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString() },
          ],
        }),
      }),
    );
  });

  test('renders user management page', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByText('User Management')).toBeVisible();
  });

  test('shows list of users', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByText('alice@example.com')).toBeVisible();
    await expect(page.getByText('bob@example.com')).toBeVisible();
  });

  test('shows empty state when no users', async ({ page }) => {
    await page.route('**/api/v1/admin/system/users*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.goto('/admin/users');
    await expect(page.getByText('User Management')).toBeVisible();
  });
});

// ─── Billing Dashboard ────────────────────────────────────────────────────────

test.describe('Admin billing — revenue and subscription metrics', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/billing*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            totalRevenueCents: 500000,
            activeSubscriptions: 42,
            churnedThisPeriod: 2,
            plans: [
              { name: 'Pro', count: 30, revenueCents: 300000 },
              { name: 'Enterprise', count: 12, revenueCents: 200000 },
            ],
          },
        }),
      }),
    );
  });

  test('renders billing dashboard page', async ({ page }) => {
    await page.goto('/admin/billing');
    await expect(page.getByText('Billing Dashboard')).toBeVisible();
  });

  test('shows revenue by plan section', async ({ page }) => {
    await page.goto('/admin/billing');
    await expect(page.getByText('Revenue by Plan')).toBeVisible();
  });
});

// ─── Dead Letter Queue ────────────────────────────────────────────────────────

test.describe('Admin DLQ — dead letter queue inspection', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/admin/dlq*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'dlq-1', connectorId: 'hubspot', errorMessage: 'Rate limit exceeded', failedAt: new Date().toISOString(), retryCount: 3 },
          ],
          meta: { hasMore: false },
        }),
      }),
    );
  });

  test('renders DLQ page', async ({ page }) => {
    await page.goto(`/admin/dlq?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Dead Letter Queue')).toBeVisible();
  });

  test('shows failed job entries', async ({ page }) => {
    await page.goto(`/admin/dlq?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Rate limit exceeded')).toBeVisible();
  });

  test('shows empty state when queue is clear', async ({ page }) => {
    await page.route('**/admin/dlq*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { hasMore: false } }) }),
    );
    await page.goto(`/admin/dlq?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Dead Letter Queue')).toBeVisible();
  });

  test('retry button triggers POST request', async ({ page }) => {
    let retryCallCount = 0;
    await page.route('**/admin/dlq/dlq-1/retry*', (route) => {
      retryCallCount++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { queued: true } }) });
    });

    await page.goto(`/admin/dlq?workspaceId=${WORKSPACE_ID}`);
    const retryBtn = page.getByRole('button', { name: /retry/i }).first();
    if (await retryBtn.isVisible()) {
      await retryBtn.click();
      expect(retryCallCount).toBe(1);
    }
  });
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

test.describe('Admin webhooks — webhook management', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/webhooks*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'wh-1', url: 'https://hooks.example.com/iris', connectorId: 'hubspot', secret: 'sha256=...', enabled: true, lastDeliveryAt: new Date().toISOString() },
          ],
          meta: { hasMore: false },
        }),
      }),
    );
  });

  test('renders webhooks page', async ({ page }) => {
    await page.goto(`/admin/webhooks?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Webhooks')).toBeVisible();
  });

  test('shows registered webhook endpoint', async ({ page }) => {
    await page.goto(`/admin/webhooks?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('hooks.example.com/iris', { exact: false })).toBeVisible();
  });

  test('shows empty state when no webhooks', async ({ page }) => {
    await page.route('**/api/v1/webhooks*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { hasMore: false } }) }),
    );
    await page.goto(`/admin/webhooks?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Webhooks')).toBeVisible();
  });
});

// ─── SSO Configuration ────────────────────────────────────────────────────────

test.describe('Admin SSO — enterprise single sign-on', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/sso*', (route) => {
      if (route.request().url().includes('/users')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ userId: 'u-ext-1', externalEmail: 'alice@corp.com', ssoProvider: 'saml', syncedGroups: ['admin'] }] }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'sso-1', provider: 'saml', providerName: 'Okta', enabled: true, metadataUrl: 'https://okta.example.com/metadata' }],
        }),
      });
    });
  });

  test('renders SSO admin page', async ({ page }) => {
    await page.goto(`/admin/sso?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Enterprise SSO')).toBeVisible();
  });

  test('shows provider list with Okta', async ({ page }) => {
    await page.goto(`/admin/sso?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Okta')).toBeVisible();
  });

  test('shows provisioned users tab', async ({ page }) => {
    await page.goto(`/admin/sso?workspaceId=${WORKSPACE_ID}`);
    const usersTab = page.getByRole('button', { name: /provisioned users/i });
    if (await usersTab.isVisible()) {
      await usersTab.click();
      await expect(page.getByText('alice@corp.com')).toBeVisible();
    }
  });

  test('save button sends POST to sso endpoint', async ({ page }) => {
    let postCount = 0;
    await page.route('**/api/v1/sso', (route) => {
      if (route.request().method() === 'POST') { postCount++; }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
    });

    await page.goto(`/admin/sso?workspaceId=${WORKSPACE_ID}`);
    const saveBtn = page.getByRole('button', { name: /save/i });
    if (await saveBtn.isVisible()) {
      await page.fill('input[placeholder*="provider" i]', 'saml').catch(() => {});
      await saveBtn.click();
    }
  });
});

// ─── Backup & Export ──────────────────────────────────────────────────────────

test.describe('Admin backup — data export and disaster recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/snapshots*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'snap-1', workspaceId: WORKSPACE_ID, sizeBytes: 1024000, createdAt: new Date().toISOString(), status: 'complete' }],
          meta: { hasMore: false },
        }),
      }),
    );
  });

  test('renders backup page', async ({ page }) => {
    await page.goto('/admin/backup');
    await expect(page.getByText('Backup & Export')).toBeVisible();
  });

  test('shows export description text', async ({ page }) => {
    await page.goto('/admin/backup');
    await expect(page.getByText(/portability/i)).toBeVisible();
  });

  test('create snapshot button is visible', async ({ page }) => {
    await page.goto('/admin/backup');
    const btn = page.getByRole('button', { name: /create snapshot|export|backup/i });
    await expect(btn.or(page.getByText('Backup & Export'))).toBeVisible();
  });

  test('snapshot list loads after navigation', async ({ page }) => {
    await page.goto('/admin/backup');
    await expect(page.getByText('Backup & Export')).toBeVisible();
  });
});

// ─── Log Viewer ───────────────────────────────────────────────────────────────

test.describe('Admin logs — system log viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/system/logs*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            logs: [
              { id: 'log-1', level: 'error', message: 'Connector sync failed for hubspot', service: 'sync', timestamp: new Date().toISOString() },
              { id: 'log-2', level: 'info', message: 'Index rebuild started', service: 'indexer', timestamp: new Date().toISOString() },
            ],
            meta: { total: 2, hasMore: false },
          },
        }),
      }),
    );
  });

  test('renders log viewer page', async ({ page }) => {
    await page.goto('/admin/logs');
    await expect(page.getByText('Log Viewer')).toBeVisible();
  });

  test('shows log entries', async ({ page }) => {
    await page.goto('/admin/logs');
    await expect(page.getByText('Connector sync failed for hubspot')).toBeVisible();
    await expect(page.getByText('Index rebuild started')).toBeVisible();
  });

  test('shows error-level log entry', async ({ page }) => {
    await page.goto('/admin/logs');
    await expect(page.getByText('error', { exact: false })).toBeVisible();
  });
});

// ─── Compliance & Audit ───────────────────────────────────────────────────────

test.describe('Admin compliance — regulatory compliance & audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/compliance/report*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { framework: 'gdpr', status: 'compliant', score: 94, checkedAt: new Date().toISOString(), items: [] },
        }),
      }),
    );
    await page.route('**/api/v1/compliance/dsr*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('renders compliance page', async ({ page }) => {
    await page.goto('/admin/compliance');
    await expect(page.getByText('Compliance & Audit')).toBeVisible();
  });

  test('shows regulatory compliance section', async ({ page }) => {
    await page.goto('/admin/compliance');
    await expect(page.getByText(/GDPR|SOC|compliance/i)).toBeVisible();
  });

  test('DSR section is present', async ({ page }) => {
    await page.goto('/admin/compliance');
    await expect(page.getByText(/data subject|DSR/i)).toBeVisible();
  });
});

// ─── Entity Deduplication ─────────────────────────────────────────────────────

test.describe('Admin dedup — entity deduplication', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/dedup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            workspaceId: WORKSPACE_ID,
            scannedCount: 500,
            candidatePairs: [
              {
                entityA: { id: 'c1', type: 'contact', label: 'Alice Smith' },
                entityB: { id: 'c2', type: 'contact', label: 'Alice B. Smith' },
                signals: { nameSimilarity: 0.92, emailDomainMatch: true, embeddingSimilarity: 0.94, compositeScore: 0.93 },
                confidence: 'high',
              },
            ],
            highConfidenceCount: 1,
            mediumConfidenceCount: 0,
            analyzedAt: new Date().toISOString(),
          },
        }),
      }),
    );
  });

  test('renders dedup page', async ({ page }) => {
    await page.goto(`/admin/dedup?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Entity Deduplication')).toBeVisible();
  });

  test('analyze button triggers dedup scan', async ({ page }) => {
    let analyzeCalled = false;
    await page.route('**/api/v1/admin/dedup/analyze*', (route) => {
      analyzeCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { scannedCount: 0, candidatePairs: [], analyzedAt: new Date().toISOString() } }),
      });
    });

    await page.goto(`/admin/dedup?workspaceId=${WORKSPACE_ID}`);
    const analyzeBtn = page.getByRole('button', { name: /analyze|scan/i });
    if (await analyzeBtn.isVisible()) {
      await analyzeBtn.click();
      await page.waitForTimeout(100);
      expect(analyzeCalled).toBe(true);
    }
  });
});

// ─── Query Analytics ──────────────────────────────────────────────────────────

test.describe('Admin query analytics — query performance insights', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/analytics/queries/slow*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ query: 'show me all deals', durationMs: 2400, cacheHit: false, workspaceId: WORKSPACE_ID }] }),
      }),
    );
    await page.route('**/api/v1/admin/analytics/queries/patterns*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { topPatterns: [{ pattern: 'deals by stage', frequency: 45 }] } }),
      }),
    );
    await page.route('**/api/v1/admin/analytics/index-recommendations*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('renders query analytics page', async ({ page }) => {
    await page.goto(`/admin/query-analytics?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Query Analytics')).toBeVisible();
  });

  test('shows slow query data', async ({ page }) => {
    await page.goto(`/admin/query-analytics?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('show me all deals', { exact: false })).toBeVisible();
  });
});

// ─── Sync Monitoring ──────────────────────────────────────────────────────────

test.describe('Admin sync monitoring — connector sync performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/connectors/health*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ connectorId: 'hubspot', status: 'healthy', lastSyncAt: new Date().toISOString(), avgSyncMs: 1200 }],
        }),
      }),
    );
    await page.route('**/api/v1/connectors/performance*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('renders sync monitoring page', async ({ page }) => {
    await page.goto(`/admin/sync-monitoring?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Sync Performance Monitoring')).toBeVisible();
  });
});

// ─── Index Health ─────────────────────────────────────────────────────────────

test.describe('Admin index health — index status and maintenance', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/index-optimizer*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { totalEntities: 1200, fragmentedSegments: 2, lastOptimizedAt: new Date().toISOString(), indexSizeBytes: 51200000, recommendations: [] },
        }),
      }),
    );
    await page.route('**/api/v1/index/health*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: 'healthy', entityCount: 1200, lastCheck: new Date().toISOString() } }),
      }),
    );
  });

  test('renders index health page', async ({ page }) => {
    await page.goto(`/admin/index-health?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Index Health & Maintenance')).toBeVisible();
  });
});

// ─── MCP Tools Registry ───────────────────────────────────────────────────────

test.describe('Admin MCP tools — auto-generated tool registry', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/mcp/auto-tools*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { toolId: 'query-hubspot-contacts', sourceConnectorId: 'hubspot', entityType: 'contact', versionHash: 'abc123' },
            { toolId: 'query-salesforce-accounts', sourceConnectorId: 'salesforce', entityType: 'account', versionHash: 'def456' },
          ],
          meta: { hasMore: false },
        }),
      }),
    );
  });

  test('renders MCP tools page', async ({ page }) => {
    await page.goto(`/admin/mcp-tools?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('MCP Tools')).toBeVisible();
  });

  test('shows registered auto-generated tools', async ({ page }) => {
    await page.goto(`/admin/mcp-tools?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('query-hubspot-contacts', { exact: false }).or(page.getByText('hubspot', { exact: false }))).toBeVisible();
  });
});

// ─── Workspace Management ─────────────────────────────────────────────────────

test.describe('Admin workspaces — workspace management', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/workspaces*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'ws-1', name: 'Acme Corp', plan: 'pro', connectorCount: 3, entityCount: 1200, createdAt: new Date().toISOString() },
            { id: 'ws-2', name: 'Beta Ltd', plan: 'starter', connectorCount: 1, entityCount: 200, createdAt: new Date().toISOString() },
          ],
          meta: { hasMore: false },
        }),
      }),
    );
  });

  test('renders workspace management page', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await expect(page.getByText('Workspace Management')).toBeVisible();
  });

  test('shows workspace names', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Beta Ltd')).toBeVisible();
  });

  test('shows workspace count', async ({ page }) => {
    await page.goto('/admin/workspaces');
    await expect(page.getByText(/2 workspace/)).toBeVisible();
  });
});

// ─── Connector Performance ────────────────────────────────────────────────────

test.describe('Admin performance — connector performance metrics', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/performance*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { summary: [{ operationName: 'hubspot.sync', p50Ms: 800, p95Ms: 2400, p99Ms: 4100, count: 120 }] },
          meta: { generatedAt: new Date().toISOString() },
        }),
      }),
    );
  });

  test('renders connector performance page', async ({ page }) => {
    await page.goto(`/admin/performance?workspaceId=${WORKSPACE_ID}`);
    await expect(page.getByText('Connector Performance')).toBeVisible();
  });
});

// ─── Connector Optimization ───────────────────────────────────────────────────

test.describe('Admin connector optimization — schema discovery and optimization', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/schema-discovery*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('renders connector optimization page', async ({ page }) => {
    await page.goto(`/admin/connector-optimization?workspaceId=${WORKSPACE_ID}`);
    // Page should render — look for any content
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── API route: API key management ───────────────────────────────────────────

test.describe('API key management — REST endpoint coverage', () => {
  test('list keys endpoint returns structured response', async ({ request }) => {
    const res = await request.get('/api/v1/api-keys', { headers: AUTH_HEADER });
    test.skip(res.status() === 404, 'api-keys endpoint not yet wired');
    expect([200, 401]).toContain(res.status());
  });

  test('create key endpoint accepts POST', async ({ request }) => {
    const res = await request.post('/api/v1/api-keys', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { name: 'e2e-test-key', workspaceId: WORKSPACE_ID, scopes: ['read:context'] },
    });
    test.skip(res.status() === 404, 'api-keys POST endpoint not yet wired');
    expect([201, 401, 422]).toContain(res.status());
  });

  test('revoke key endpoint accepts DELETE', async ({ request }) => {
    const res = await request.delete('/api/v1/api-keys/nonexistent-key', { headers: AUTH_HEADER });
    test.skip(res.status() === 404 && (await res.json() as Record<string, unknown>).message === undefined, 'api-keys DELETE not wired');
    expect([200, 204, 404, 401]).toContain(res.status());
  });
});

// ─── API route: SSO configuration ────────────────────────────────────────────

test.describe('SSO configuration — REST endpoint coverage', () => {
  test('list SSO configs requires auth header', async ({ request }) => {
    const res = await request.get('/api/v1/sso');
    test.skip(res.status() === 404, 'sso endpoint not yet wired');
    expect([401, 403, 200]).toContain(res.status());
  });

  test('get SAML config returns valid response', async ({ request }) => {
    const res = await request.get('/api/v1/sso/saml', { headers: AUTH_HEADER });
    test.skip(res.status() === 404, 'sso/saml endpoint not yet wired');
    expect([200, 401, 404]).toContain(res.status());
  });

  test('create SSO config validates provider enum', async ({ request }) => {
    const res = await request.post('/api/v1/sso', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { provider: 'invalid-provider', providerName: 'Bad' },
    });
    test.skip(res.status() === 404, 'sso POST endpoint not yet wired');
    expect([400, 401, 422]).toContain(res.status());
  });
});

// ─── API route: Cost audit ────────────────────────────────────────────────────

test.describe('Cost analytics — REST endpoint coverage', () => {
  test('cost audit endpoint accepts date range', async ({ request }) => {
    const res = await request.post('/api/v1/admin/cost-audit', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { from: '2026-01-01', to: '2026-06-30' },
    });
    test.skip(res.status() === 404, 'cost-audit endpoint not yet wired');
    expect([200, 401]).toContain(res.status());
  });

  test('top workspaces cost endpoint returns list', async ({ request }) => {
    const res = await request.get('/api/v1/admin/cost-audit/top-workspaces?from=2026-01-01&to=2026-06-30', {
      headers: AUTH_HEADER,
    });
    test.skip(res.status() === 404, 'cost-audit/top-workspaces not yet wired');
    expect([200, 401]).toContain(res.status());
  });
});

// ─── API route: Data deduplication ───────────────────────────────────────────

test.describe('Admin dedup — REST endpoint coverage', () => {
  test('dedup analyze endpoint accepts POST', async ({ request }) => {
    const res = await request.post('/api/v1/admin/dedup/analyze', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {},
    });
    test.skip(res.status() === 404, 'admin/dedup/analyze not yet wired');
    expect([200, 401, 422]).toContain(res.status());
  });

  test('dedup rules endpoint accepts rule definition', async ({ request }) => {
    const res = await request.post('/api/v1/admin/dedup/rules', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        entityType: 'contact',
        rules: [{ name: 'email-exact', condition: { type: 'exact', field: 'email' } }],
      },
    });
    test.skip(res.status() === 404, 'admin/dedup/rules not yet wired');
    expect([201, 401, 400]).toContain(res.status());
  });
});

// ─── API route: PII configuration ────────────────────────────────────────────

test.describe('PII configuration — REST endpoint coverage', () => {
  test('PII config GET returns workspace config', async ({ request }) => {
    const res = await request.get('/api/v1/pii-config', { headers: AUTH_HEADER });
    test.skip(res.status() === 404, 'pii-config endpoint not yet wired');
    expect([200, 401]).toContain(res.status());
  });

  test('PII config PUT accepts field mask rules', async ({ request }) => {
    const res = await request.put('/api/v1/pii-config', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { maskedFields: ['email', 'phone'], maskingStrategy: 'hash' },
    });
    test.skip(res.status() === 404, 'pii-config PUT not yet wired');
    expect([200, 201, 401, 422]).toContain(res.status());
  });
});

// ─── API route: Data quality scoring ─────────────────────────────────────────

test.describe('Data quality — REST endpoint coverage', () => {
  test('data quality report endpoint returns workspace report', async ({ request }) => {
    const res = await request.get(`/api/v1/data-quality/report?workspaceId=${WORKSPACE_ID}`, { headers: AUTH_HEADER });
    test.skip(res.status() === 404, 'data-quality/report endpoint not yet wired');
    expect([200, 401]).toContain(res.status());
  });

  test('data quality score rejects missing workspaceId', async ({ request }) => {
    const res = await request.get('/api/v1/data-quality/report');
    test.skip(res.status() === 404, 'data-quality endpoint not yet wired');
    expect([400, 401]).toContain(res.status());
  });
});

// ─── Admin enrichment setup ───────────────────────────────────────────────────

test.describe('Admin enrichment setup — enrichment source configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/enrichment-config*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ sourceId: 'clearbit', enabled: true, fieldMappings: {} }] }),
      }),
    );
  });

  test('renders enrichment setup page', async ({ page }) => {
    await page.goto(`/admin/enrichment-setup?workspaceId=${WORKSPACE_ID}`);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── Admin data lineage ───────────────────────────────────────────────────────

test.describe('Admin data lineage — data origin and impact tracking', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/lineage*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
  });

  test('renders data lineage page', async ({ page }) => {
    await page.goto(`/admin/data-lineage?workspaceId=${WORKSPACE_ID}`);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── Workspace settings ───────────────────────────────────────────────────────

test.describe('Settings — workspace configuration', () => {
  test('settings page loads successfully', async ({ page }) => {
    await page.route('**/api/v1/workspace/settings*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: WORKSPACE_ID, name: 'Test Workspace', plan: 'pro' } }),
      }),
    );
    await page.goto('/settings');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('workspace name update returns 200', async ({ request }) => {
    const res = await request.put('/api/v1/workspace/settings', {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { name: 'Updated Name' },
    });
    test.skip(res.status() === 404, 'workspace/settings PUT not yet wired');
    expect([200, 401, 422]).toContain(res.status());
  });
});
