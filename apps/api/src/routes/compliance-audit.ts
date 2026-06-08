import { Hono } from 'hono';
import { z } from 'zod';
import {
  generateAuditReport,
  signAuditLog,
  verifyAuditSignature,
  detectAnomalousAccess,
  exportToComplianceFormat,
  saveSignedExport,
  saveAnomalyAlerts,
  reportToCSV,
  type ComplianceFormat,
} from '@iris/semantic-core/compliance-auditor';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'compliance-audit' });

const exportSchema = z.object({
  workspaceId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  format: z.enum(['json', 'csv']).default('json'),
  complianceFormat: z.enum(['soc2', 'gdpr', 'hipaa']).optional(),
  requestedByUserId: z.string().min(1),
});

const anomalySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  save: z.coerce.boolean().default(false),
});

/** @returns Hono router for compliance audit endpoints */
export function createComplianceAuditRoutes(sql: Parameters<typeof generateAuditReport>[0]) {
  const app = new Hono();

  // POST /api/v1/compliance/audit-export
  app.post('/audit-export', async c => {
    const raw = await c.req.json().catch(() => ({})) as unknown;
    const parsed = exportSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const body = parsed.data;
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    if (endDate <= startDate) {
      return c.json({ error: { code: 'INVALID_DATE_RANGE', message: 'endDate must be after startDate' } }, 400);
    }

    const reportResult = await generateAuditReport(sql, body.workspaceId, startDate, endDate, body.format);
    if (reportResult.isErr()) {
      log.error('Audit report generation failed', { error: reportResult.error.message });
      return c.json({ error: { code: 'REPORT_FAILED', message: reportResult.error.message } }, 500);
    }

    const report = reportResult.value;

    if (body.complianceFormat) {
      const compResult = exportToComplianceFormat(report, body.complianceFormat as ComplianceFormat);
      if (compResult.isErr()) {
        return c.json({ error: { code: 'FORMAT_FAILED', message: compResult.error.message } }, 500);
      }
      const signResult = signAuditLog(report);
      if (signResult.isOk()) {
        await saveSignedExport(sql, body.workspaceId, signResult.value, body.requestedByUserId);
      }
      return c.json({
        data: {
          complianceReport: compResult.value,
          exportId: signResult.isOk() ? signResult.value.exportId : null,
          signature: signResult.isOk() ? signResult.value.signature : null,
          totalAuditRecords: report.totalRecords,
        },
      }, 201);
    }

    const signResult = signAuditLog(report);
    if (signResult.isErr()) {
      log.error('Signing failed', { error: signResult.error.message });
      return c.json({ error: { code: 'SIGN_FAILED', message: signResult.error.message } }, 500);
    }

    const signed = signResult.value;
    await saveSignedExport(sql, body.workspaceId, signed, body.requestedByUserId);

    if (body.format === 'csv') {
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', `attachment; filename="audit-${signed.exportId}.csv"`);
      return c.text(reportToCSV(report));
    }

    return c.json({
      data: {
        exportId: signed.exportId,
        signature: signed.signature,
        publicKey: signed.publicKey,
        signedAt: signed.signedAt,
        report: {
          workspaceId: report.workspaceId,
          startDate: report.startDate,
          endDate: report.endDate,
          totalRecords: report.totalRecords,
          generatedAt: report.generatedAt,
          records: report.records,
        },
      },
    }, 201);
  });

  // GET /api/v1/compliance/audit-exports
  app.get('/audit-exports', async c => {
    const workspaceId = c.req.query('workspaceId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const cursor = c.req.query('cursor');

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }

    try {
      const rows = await sql`
        SELECT export_id, start_date, end_date, signed_at, requested_by_user_id, tamper_check_status
        FROM signed_audit_exports
        WHERE workspace_id = ${workspaceId}
          ${cursor ? sql`AND signed_at < ${new Date(cursor)}` : sql``}
        ORDER BY signed_at DESC
        LIMIT ${limit + 1}
      ` as unknown as Array<{
        export_id: string;
        start_date: string;
        end_date: string;
        signed_at: string;
        requested_by_user_id: string;
        tamper_check_status: string;
      }>;

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const nextCursor = hasMore ? items[items.length - 1]?.signed_at : undefined;

      return c.json({
        data: items,
        meta: { hasMore, nextCursor: nextCursor ?? null },
      });
    } catch (e) {
      log.error('List exports failed', { error: String(e) });
      return c.json({ error: { code: 'LIST_FAILED', message: 'Failed to list exports' } }, 500);
    }
  });

  // GET /api/v1/compliance/anomalies
  app.get('/anomalies', async c => {
    const rawQuery = { days: c.req.query('days'), save: c.req.query('save') };
    const parsedQuery = anomalySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsedQuery.error.message } }, 400);
    }
    const { days, save } = parsedQuery.data;
    const workspaceId = c.req.query('workspaceId');

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }

    const result = await detectAnomalousAccess(sql, workspaceId, days);
    if (result.isErr()) {
      log.error('Anomaly detection failed', { error: result.error.message });
      return c.json({ error: { code: 'DETECT_FAILED', message: result.error.message } }, 500);
    }

    const alerts = result.value;

    if (save && alerts.length > 0) {
      await saveAnomalyAlerts(sql, workspaceId, alerts);
    }

    return c.json({ data: alerts, meta: { total: alerts.length } });
  });

  // GET /api/v1/compliance/verify-export/:exportId
  app.get('/verify-export/:exportId', async c => {
    const exportId = c.req.param('exportId');
    const workspaceId = c.req.query('workspaceId');

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }

    try {
      const rows = await sql`
        SELECT signature, public_key, signed_at, tamper_check_status
        FROM signed_audit_exports
        WHERE export_id = ${exportId} AND workspace_id = ${workspaceId}
        LIMIT 1
      ` as unknown as Array<{
        signature: string;
        public_key: string;
        signed_at: string;
        tamper_check_status: string;
      }>;

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Export not found' } }, 404);
      }

      const row = rows[0]!;
      return c.json({
        data: {
          exportId,
          tamperCheckStatus: row.tamper_check_status,
          signedAt: row.signed_at,
          verified: row.tamper_check_status === 'valid',
        },
      });
    } catch (e) {
      log.error('Verify export failed', { error: String(e) });
      return c.json({ error: { code: 'VERIFY_FAILED', message: 'Failed to verify export' } }, 500);
    }
  });

  return app;
}
