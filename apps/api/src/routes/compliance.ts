import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ComplianceReporter } from '@iris/semantic-core/compliance-reporter';
import type { ComplianceFramework } from '@iris/semantic-core/compliance-reporter';

type SqlClient = ReturnType<typeof postgres>;

const FRAMEWORKS: ComplianceFramework[] = ['hipaa', 'soc2', 'gdpr', 'ccpa'];

const dsrSchema = z.object({
  requestType: z.enum(['access', 'deletion', 'portability', 'correction']),
  subjectEmail: z.string().email(),
  submittedBy: z.string().min(1),
});

const auditLogQuerySchema = z.object({
  userId: z.string().optional(),
  entityId: z.string().optional(),
  eventType: z.enum(['access', 'export', 'delete', 'modify', 'share']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * REST routes for compliance and audit reporting.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createComplianceRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ComplianceReporter(sql as unknown as any);

  const getWorkspaceId = (c: Parameters<typeof app.get>[1] extends (c: infer C) => unknown ? C : never) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /compliance/report/:framework — generate compliance report */
  app.get('/report/:framework', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const framework = c.req.param('framework') as ComplianceFramework;
    if (!FRAMEWORKS.includes(framework)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: `Framework must be one of: ${FRAMEWORKS.join(', ')}` } }, 400);
    }

    const days = parseInt(c.req.query('days') ?? '30', 10);
    const result = await svc.generateReport(workspaceId, framework, days);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /compliance/dsr — create data subject request */
  app.post('/dsr', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }
    const parsed = dsrSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await svc.createDsr(workspaceId, parsed.data.requestType, parsed.data.subjectEmail, parsed.data.submittedBy);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  /** GET /compliance/dsr — list DSRs */
  app.get('/dsr', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const status = c.req.query('status') as Parameters<typeof svc.listDsrs>[1];
    const result = await svc.listDsrs(workspaceId, status);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** GET /compliance/audit-log — searchable audit trail */
  app.get('/audit-log', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const parsed = auditLogQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await svc.getAuditLog(workspaceId, parsed.data);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** GET /compliance/alerts — list open anomaly alerts */
  app.get('/alerts', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await svc.getAlerts(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /compliance/alerts/:id/acknowledge */
  app.post('/alerts/:id/acknowledge', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const acknowledgedBy = c.req.header('x-user-id') ?? 'unknown';
    const result = await svc.acknowledgeAlert(c.req.param('id'), acknowledgedBy);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { success: true } });
  });

  return app;
}
