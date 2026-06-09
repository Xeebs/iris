import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDataQualityEngineRoutes } from '../routes/data-quality-engine-routes.js';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}));

const WORKSPACE_ID = 'ws-test-001';
const SCAN_ID = '00000000-0000-0000-0000-000000000001';
const CONNECTOR_ID = 'hubspot';
const ISSUE_ID = '00000000-0000-0000-0000-000000000002';

const mockScan = {
  scan_id: SCAN_ID,
  connector_id: CONNECTOR_ID,
  workspace_id: WORKSPACE_ID,
  started_at: new Date('2026-06-09T10:00:00Z'),
  completed_at: new Date('2026-06-09T10:00:05Z'),
  total_entities: 30,
  issues_found: 3,
  status: 'completed',
};

const mockIssue = {
  issue_id: ISSUE_ID,
  scan_id: SCAN_ID,
  entity_id: 'hubspot:contact:abc',
  issue_type: 'required_field_missing',
  severity: 'high',
  field_name: 'email',
  expected_type: null,
  actual_value: null,
  resolved_at: null,
  created_at: new Date('2026-06-09T10:00:01Z'),
};

let mockSqlCalls: unknown[][] = [];
const mockSql = vi.fn((...args: unknown[]) => {
  mockSqlCalls.push(args);
  return Promise.resolve([]);
}) as unknown as ReturnType<typeof import('postgres').default>;

// Allow template-literal style calls (sql`...`) and tagged template calls
(mockSql as unknown as Record<string, unknown>)[''] = mockSql;

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', WORKSPACE_ID);
    await next();
  });
  app.route('/data-quality', createDataQualityEngineRoutes(mockSql as never));
  return app;
}

describe('data-quality-engine-routes', () => {
  beforeEach(() => {
    // mockReset clears queued mockResolvedValueOnce values; clearAllMocks does not
    (mockSql as ReturnType<typeof vi.fn>).mockReset();
    mockSqlCalls = [];
    (mockSql as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe('POST /data-quality/scans/:connectorId', () => {
    it('creates a scan and returns 201 on success', async () => {
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockScan])     // INSERT scan
        .mockResolvedValueOnce([])             // SELECT quality_issues
        .mockResolvedValueOnce([mockScan]);    // UPDATE scan completed

      const app = makeApp();
      const res = await app.request(`/data-quality/scans/${CONNECTOR_ID}`, { method: 'POST' });
      expect(res.status).toBe(201);
      const body = await res.json() as { data: typeof mockScan };
      expect(body.data).toBeDefined();
    });

    it('returns 401 when workspace header is missing', async () => {
      const app = new Hono();
      app.route('/data-quality', createDataQualityEngineRoutes(mockSql as never));
      const res = await app.request(`/data-quality/scans/${CONNECTOR_ID}`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 500 when INSERT scan returns empty', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();
      const res = await app.request(`/data-quality/scans/${CONNECTOR_ID}`, { method: 'POST' });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('marks scan as failed when scan execution throws', async () => {
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockScan])
        .mockRejectedValueOnce(new Error('DB error'));

      const app = makeApp();
      const res = await app.request(`/data-quality/scans/${CONNECTOR_ID}`, { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /data-quality/scans/:scanId', () => {
    it('returns scan and its issues', async () => {
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([mockScan])
        .mockResolvedValueOnce([mockIssue]);

      const app = makeApp();
      const res = await app.request(`/data-quality/scans/${SCAN_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { scan: typeof mockScan; issues: typeof mockIssue[] } };
      expect(body.data.scan.scan_id).toBe(SCAN_ID);
      expect(body.data.issues).toHaveLength(1);
    });

    it('returns 404 when scan not found', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();
      const res = await app.request(`/data-quality/scans/${SCAN_ID}`);
      expect(res.status).toBe(404);
    });

    it('returns 401 without workspace', async () => {
      const app = new Hono();
      app.route('/data-quality', createDataQualityEngineRoutes(mockSql as never));
      const res = await app.request(`/data-quality/scans/${SCAN_ID}`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /data-quality/issues', () => {
    it('returns paginated issues with no filters', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockIssue]);
      const app = makeApp();
      const res = await app.request('/data-quality/issues');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta.hasMore).toBe(false);
    });

    it('passes severity filter through', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockIssue]);
      const app = makeApp();
      const res = await app.request('/data-quality/issues?severity=high');
      expect(res.status).toBe(200);
    });

    it('passes issueType filter through', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();
      const res = await app.request('/data-quality/issues?issueType=type_mismatch');
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid severity value', async () => {
      const app = makeApp();
      const res = await app.request('/data-quality/issues?severity=critical');
      expect(res.status).toBe(400);
    });

    it('returns hasMore=true and nextCursor when page is full', async () => {
      const issues = Array.from({ length: 51 }, (_, i) => ({ ...mockIssue, issue_id: `issue-${i}` }));
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce(issues);
      const app = makeApp();
      const res = await app.request('/data-quality/issues?limit=50');
      expect(res.status).toBe(200);
      const body = await res.json() as { meta: { hasMore: boolean; nextCursor: string | null } };
      expect(body.meta.hasMore).toBe(true);
      expect(body.meta.nextCursor).not.toBeNull();
    });
  });

  describe('POST /data-quality/issues/:issueId/resolve', () => {
    it('resolves an open issue', async () => {
      const resolvedIssue = { ...mockIssue, resolved_at: new Date(), workspace_id: WORKSPACE_ID };
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ ...mockIssue, workspace_id: WORKSPACE_ID }])
        .mockResolvedValueOnce([resolvedIssue]);

      const app = makeApp();
      const res = await app.request(`/data-quality/issues/${ISSUE_ID}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remediationNotes: 'Fixed manually' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 404 when issue does not exist', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const app = makeApp();
      const res = await app.request(`/data-quality/issues/${ISSUE_ID}/resolve`, { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 403 when issue belongs to different workspace', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { ...mockIssue, workspace_id: 'other-workspace' },
      ]);
      const app = makeApp();
      const res = await app.request(`/data-quality/issues/${ISSUE_ID}/resolve`, { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('returns 409 when issue already resolved', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { ...mockIssue, workspace_id: WORKSPACE_ID, resolved_at: new Date() },
      ]);
      const app = makeApp();
      const res = await app.request(`/data-quality/issues/${ISSUE_ID}/resolve`, { method: 'POST' });
      expect(res.status).toBe(409);
    });

    it('returns 400 for oversized remediationNotes', async () => {
      (mockSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { ...mockIssue, workspace_id: WORKSPACE_ID },
      ]);
      const app = makeApp();
      const res = await app.request(`/data-quality/issues/${ISSUE_ID}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remediationNotes: 'x'.repeat(1001) }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /data-quality/report', () => {
    it('returns summary, top connectors, and trend', async () => {
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ total_issues: '10', resolved_issues: '3', high_count: '4', medium_count: '4', low_count: '2' }])
        .mockResolvedValueOnce([{ connector_id: 'hubspot', issue_count: '7' }])
        .mockResolvedValueOnce([{ day: '2026-06-09', issue_count: '5' }]);

      const app = makeApp();
      const res = await app.request('/data-quality/report');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        data: {
          summary: { totalIssues: number; openIssues: number; bySeverity: Record<string, number> };
          topProblematicConnectors: { connectorId: string; openIssueCount: number }[];
          trend: { day: string; issueCount: number }[];
        };
      };
      expect(body.data.summary.totalIssues).toBe(10);
      expect(body.data.summary.openIssues).toBe(7);
      expect(body.data.summary.bySeverity.high).toBe(4);
      expect(body.data.topProblematicConnectors[0]?.connectorId).toBe('hubspot');
      expect(body.data.trend).toHaveLength(1);
    });

    it('returns zeros when no data exists', async () => {
      (mockSql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const app = makeApp();
      const res = await app.request('/data-quality/report');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { summary: { totalIssues: number } } };
      expect(body.data.summary.totalIssues).toBe(0);
    });

    it('returns 401 without workspace', async () => {
      const app = new Hono();
      app.route('/data-quality', createDataQualityEngineRoutes(mockSql as never));
      const res = await app.request('/data-quality/report');
      expect(res.status).toBe(401);
    });
  });
});
