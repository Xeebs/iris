import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { ReliabilityPredictor } from '@iris/semantic-core/reliability-predictor';

const log = logger.child({ route: 'reliability-scoring' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const suppressAlertSchema = z.object({
  alertType: z.string().min(1),
  suppressedBy: z.string().min(1),
  durationMs: z.number().int().positive().optional().default(86_400_000),
  reason: z.string().optional(),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @returns Hono sub-app mounted at /api/v1/connectors
 */
export function createReliabilityScoringRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const predictor = new ReliabilityPredictor(
    sql as ConstructorParameters<typeof ReliabilityPredictor>[0],
  );

  // GET /:id/reliability — score + trend + forecast
  app.get('/:id/reliability', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const connectorId = c.req.param('id');

    const [scoreResult, forecastResult, patternResult] = await Promise.all([
      predictor.computeReliabilityScore(connectorId, workspaceId),
      predictor.forecastNextFailure(connectorId, workspaceId),
      predictor.detectDegradationPattern(connectorId, workspaceId),
    ]);

    if (scoreResult.isErr()) {
      log.error('Failed to get reliability', { connectorId, error: scoreResult.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to compute reliability' } }, 500);
    }

    return c.json({
      data: {
        score: scoreResult.value,
        forecast: forecastResult.isOk() ? forecastResult.value : null,
        degradationPattern: patternResult.isOk() ? patternResult.value : null,
      },
    });
  });

  // GET /:id/alerts — recent alerts + mitigation actions
  app.get('/:id/alerts', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const connectorId = c.req.param('id');

    const [alertsResult, mitigationsResult] = await Promise.all([
      predictor.listAlerts(connectorId, workspaceId),
      predictor.suggestMitigations(connectorId, workspaceId),
    ]);

    if (alertsResult.isErr()) {
      log.error('Failed to list alerts', { connectorId, error: alertsResult.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list alerts' } }, 500);
    }

    return c.json({
      data: {
        alerts: alertsResult.value,
        mitigations: mitigationsResult.isOk() ? mitigationsResult.value : [],
      },
    });
  });

  // POST /:id/suppress-alert — silence false positives
  app.post('/:id/suppress-alert', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const connectorId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = suppressAlertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() } }, 400);
    }

    const { alertType, suppressedBy, durationMs, reason } = parsed.data;
    const result = await predictor.suppressAlert(
      connectorId, workspaceId, alertType, suppressedBy, durationMs, reason,
    );

    if (result.isErr()) {
      log.error('Failed to suppress alert', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to suppress alert' } }, 500);
    }

    return c.json({ data: { ok: true } }, 201);
  });

  // POST /:id/assess — trigger full assessment cycle
  app.post('/:id/assess', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'No workspace context' } }, 401);
    }

    const connectorId = c.req.param('id');
    const result = await predictor.runAssessmentCycle(connectorId, workspaceId);

    if (result.isErr()) {
      log.error('Assessment cycle failed', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Assessment cycle failed' } }, 500);
    }

    return c.json({ data: { alerts: result.value } });
  });

  return app;
}
