import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import type { ConnectorManifest } from '@iris/connector-sdk';
import { registry } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import type { SyncJobQueue } from '@iris/queue';
import type { SyncScheduleService } from '@iris/queue/sync-schedule-service';
import type { ConnectorHealthService, ConnectorHealthStatus } from '@iris/semantic-core/connector-health-service';
import { SchemaDiscovererService } from '@iris/semantic-core/schema-discoverer';

import { ConnectorService } from '../services/connector-service.js';

const log = logger.child({ route: 'connectors' });

type SqlClient = ReturnType<typeof postgres>;

const createInstanceSchema = z.object({
  workspaceId: z.string().min(1),
  connectorId: z.string().min(1),
  config: z.record(z.unknown()),
});

const updateInstanceSchema = z.object({
  config: z.record(z.unknown()),
});

const workspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const upsertScheduleSchema = z.object({
  frequency: z.enum(['real-time', 'hourly', 'daily', 'weekly', 'manual', 'custom']),
  cronExpression: z.string().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const schemaFieldDecisionSchema = z.object({
  originalName: z.string().min(1),
  accepted: z.boolean(),
  renamedTo: z.string().optional(),
  isPii: z.boolean(),
  entityRelationshipType: z.string().optional(),
});

const schemaConfirmationBodySchema = z.object({
  entityType: z.string().min(1),
  fields: z.array(schemaFieldDecisionSchema).min(1),
});

/**
 * Public connector-type catalog routes (no auth required).
 *
 * The onboarding flow lists available connector types before the user has a
 * workspace API key, so this catalog is mounted publicly in server.ts —
 * it only exposes static manifest metadata, never workspace data.
 *
 * @returns Hono router serving GET /types and GET /types/:connectorId
 */
export function createConnectorTypeRoutes(): Hono {
  const routes = new Hono();

  /** GET /api/v1/connectors/types — list all registered connector manifests */
  routes.get('/types', (c) => {
    const manifests: ConnectorManifest[] = registry.list();
    return c.json({ data: manifests });
  });

  /** GET /api/v1/connectors/types/:connectorId — get a connector manifest */
  routes.get('/types/:connectorId', (c) => {
    const id = c.req.param('connectorId');
    if (!registry.has(id)) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Connector type "${id}" not found` } }, 404);
    }
    return c.json({ data: registry.get(id).manifest });
  });

  return routes;
}

type LiveHealthResult = {
  status: ConnectorHealthStatus;
  latencyMs?: number;
  errorMessage?: string;
};

/**
 * Run a live health check against a connector instance's source system.
 * Never throws — any failure is reported as an unhealthy status.
 *
 * @param connectorId - Registered connector type id (e.g. "postgres")
 * @param config - Validated connector instance configuration
 * @returns Health status with optional latency and error message
 */
async function runLiveHealthCheck(
  connectorId: string,
  config: Record<string, unknown>,
): Promise<LiveHealthResult> {
  try {
    const registration = registry.get(connectorId);
    const connector = registration.factory(config);
    const connectResult = await connector.connect(config);
    if (connectResult.isErr()) {
      return { status: 'unhealthy', errorMessage: connectResult.error.message };
    }
    const health = await connector.healthCheck();
    return {
      status: health.healthy ? 'healthy' : 'unhealthy',
      ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
      ...(health.error !== undefined ? { errorMessage: health.error } : {}),
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return { status: 'unhealthy', errorMessage: error.message };
  }
}

/**
 * @param sql - Postgres client for instance persistence
 * @param syncQueue - BullMQ queue for async connector sync jobs
 * @param scheduleService - Service for managing repeatable sync schedules
 * @param healthService - Service for reading/writing connector health records
 */
export function createConnectorRoutes(
  sql: SqlClient,
  syncQueue?: SyncJobQueue,
  scheduleService?: SyncScheduleService,
  healthService?: ConnectorHealthService,
): Hono {
  const routes = new Hono();
  const service = new ConnectorService(sql);
  const schemaService = new SchemaDiscovererService(sql);

  // Connector-type catalog (also mounted publicly in server.ts for onboarding)
  routes.route('/', createConnectorTypeRoutes());

  /** GET /api/v1/connectors?workspaceId= — list connector instances */
  routes.get('/', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } },
        400,
      );
    }
    const result = await service.listInstances(parsed.data.workspaceId);
    if (result.isErr()) {
      log.error('Failed to list connector instances', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list connector instances' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/connectors — create a connector instance */
  routes.post('/', async (c) => {
    const body = createInstanceSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const { workspaceId, connectorId, config } = body.data;

    if (!registry.has(connectorId)) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Connector type "${connectorId}" not found` } },
        404,
      );
    }

    try {
      registry.validateConfig(connectorId, config);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid config';
      return c.json({ error: { code: 'VALIDATION_ERROR', message } }, 400);
    }

    const result = await service.createInstance(workspaceId, connectorId, config);
    if (result.isErr()) {
      log.error('Failed to create connector instance', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create connector instance' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/connectors/:id?workspaceId= — get a connector instance */
  routes.get('/:id', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const id = c.req.param('id');
    const result = await service.getInstance(parsed.data.workspaceId, id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** PUT /api/v1/connectors/:id?workspaceId= — update connector config */
  routes.put('/:id', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = updateInstanceSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const id = c.req.param('id');
    const result = await service.updateInstance(parsed.data.workspaceId, id, body.data.config);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update connector instance' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/connectors/:id?workspaceId= — delete a connector instance */
  routes.delete('/:id', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const id = c.req.param('id');
    const result = await service.deleteInstance(parsed.data.workspaceId, id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete connector instance' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }
    return c.json({ data: { deleted: true } });
  });

  /** POST /api/v1/connectors/:id/sync?workspaceId= — trigger a sync job */
  routes.post('/:id/sync', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const id = c.req.param('id');
    const instanceResult = await service.getInstance(parsed.data.workspaceId, id);
    if (instanceResult.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!instanceResult.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }

    const statusResult = await service.updateStatus(id, 'syncing');
    if (statusResult.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to start sync' } }, 500);
    }

    if (syncQueue) {
      const jobResult = await syncQueue.enqueueSync(id, parsed.data.workspaceId);
      if (jobResult.isErr()) {
        log.error('Failed to enqueue sync job', { instanceId: id, error: jobResult.error });
        return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to enqueue sync job' } }, 500);
      }
      log.info('Sync job enqueued', { instanceId: id, jobId: jobResult.value.jobId });
      return c.json({ data: { instanceId: id, jobId: jobResult.value.jobId, status: 'queued' } });
    }

    log.info('Sync triggered (no queue configured)', { instanceId: id, connectorId: instanceResult.value.connectorId });
    return c.json({ data: { instanceId: id, status: 'syncing' } });
  });

  /** POST /api/v1/connectors/:id/test?workspaceId= — test connector connectivity */
  routes.post('/:id/test', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const id = c.req.param('id');
    const result = await service.getInstance(parsed.data.workspaceId, id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }
    return c.json({ data: { instanceId: id, healthy: true } });
  });

  /** GET /api/v1/connectors/:id/schedule?workspaceId= — get sync schedule */
  routes.get('/:id/schedule', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    if (!scheduleService) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Schedule service not configured' } }, 503);
    }
    const id = c.req.param('id');
    const result = await scheduleService.getSchedule(parsed.data.workspaceId, id);
    if (result.isErr()) {
      log.error('Failed to get schedule', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get schedule' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** PUT /api/v1/connectors/:id/schedule?workspaceId= — upsert sync schedule */
  routes.put('/:id/schedule', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    if (!scheduleService) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Schedule service not configured' } }, 503);
    }

    const body = upsertScheduleSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid schedule config', details: body.error.errors } },
        400,
      );
    }

    const id = c.req.param('id');
    const instanceResult = await service.getInstance(parsed.data.workspaceId, id);
    if (instanceResult.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!instanceResult.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }

    const scheduleConfig = {
      frequency: body.data.frequency,
      ...(body.data.cronExpression !== undefined ? { cronExpression: body.data.cronExpression } : {}),
      ...(body.data.startTime !== undefined ? { startTime: body.data.startTime } : {}),
    };
    const result = await scheduleService.upsertSchedule(id, parsed.data.workspaceId, scheduleConfig);
    if (result.isErr()) {
      log.error('Failed to upsert schedule', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update schedule' } }, 500);
    }

    const scheduleResult = await scheduleService.getSchedule(parsed.data.workspaceId, id);
    if (scheduleResult.isErr() || !scheduleResult.value) {
      return c.json({ data: { instanceId: id, frequency: body.data.frequency } });
    }
    return c.json({ data: scheduleResult.value });
  });

  /** GET /api/v1/connectors/health?workspaceId= — get latest health for all instances */
  routes.get('/health', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    if (!healthService) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Health service not configured' } }, 503);
    }
    const result = await healthService.getAllHealth(parsed.data.workspaceId);
    if (result.isErr()) {
      log.error('Failed to get connector health', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get connector health' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/connectors/:id/schema-confirmation?workspaceId= — save user schema decisions */
  routes.post('/:id/schema-confirmation', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = schemaConfirmationBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid schema confirmation', details: body.error.errors } },
        400,
      );
    }

    const id = c.req.param('id');
    const instanceResult = await service.getInstance(parsed.data.workspaceId, id);
    if (instanceResult.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!instanceResult.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }

    const result = await schemaService.saveConfirmation(
      id,
      parsed.data.workspaceId,
      body.data.entityType,
      body.data.fields,
    );

    if (result.isErr()) {
      log.error('Failed to save schema confirmation', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save schema confirmation' } }, 500);
    }

    log.info('Schema confirmation saved', { instanceId: id, entityType: body.data.entityType });
    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/connectors/:id/schema-confirmation?workspaceId= — get saved schema decisions */
  routes.get('/:id/schema-confirmation', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const id = c.req.param('id');
    const result = await schemaService.getConfirmations(id, parsed.data.workspaceId);

    if (result.isErr()) {
      log.error('Failed to get schema confirmations', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get schema confirmations' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /**
   * GET /api/v1/connectors/:id/health?workspaceId= — latest health for one instance.
   * If no health record exists yet (fresh instance), runs a live health check
   * against the source system so onboarding gets an immediate answer.
   */
  routes.get('/:id/health', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    if (!healthService) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Health service not configured' } }, 503);
    }
    const id = c.req.param('id');
    const { workspaceId } = parsed.data;
    const result = await healthService.getHealth(id, workspaceId);
    if (result.isErr()) {
      log.error('Failed to get connector health', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get connector health' } }, 500);
    }
    if (result.value) {
      return c.json({ data: result.value });
    }

    // No stored record — run a live check now.
    const instanceResult = await service.getInstance(workspaceId, id);
    if (instanceResult.isErr()) {
      log.error('Failed to fetch instance for live health check', { instanceId: id, error: instanceResult.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch connector instance' } }, 500);
    }
    if (!instanceResult.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance "${id}" not found` } }, 404);
    }

    const live = await runLiveHealthCheck(instanceResult.value.connectorId, instanceResult.value.config);
    const recorded = await healthService.recordHealth(id, workspaceId, live.status, live.latencyMs, live.errorMessage);
    if (recorded.isErr()) {
      // Recording is best-effort — still return the live result.
      log.warn('Failed to record live health check', { instanceId: id, error: recorded.error.message });
      return c.json({
        data: {
          instanceId: id,
          workspaceId,
          status: live.status,
          latencyMs: live.latencyMs ?? null,
          errorMessage: live.errorMessage ?? null,
          checkedAt: new Date(),
        },
      });
    }
    const rec = recorded.value;
    return c.json({
      data: {
        instanceId: rec.instanceId,
        workspaceId: rec.workspaceId,
        status: rec.status,
        latencyMs: rec.latencyMs,
        errorMessage: rec.errorMessage,
        checkedAt: rec.checkedAt,
      },
    });
  });

  const syncLogsQuerySchema = z.object({
    workspaceId: z.string().min(1),
    limit: z.coerce.number().int().positive().max(200).default(50),
    cursor: z.string().optional(),
    severity: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  });

  /** GET /api/v1/connectors/:id/sync-logs?workspaceId= — recent sync events */
  routes.get('/:id/sync-logs', async (c) => {
    const parsed = syncLogsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required', details: parsed.error.errors } }, 400);
    }
    const { workspaceId, limit, cursor, severity } = parsed.data;
    const id = c.req.param('id');

    try {
      type SyncLogRow = {
        id: string; instance_id: string; workspace_id: string; sync_id: string;
        event_type: string; severity: string; message: string;
        details: unknown; timestamp: string;
      };

      const rows = await sql<SyncLogRow[]>`
        SELECT id, instance_id, workspace_id, sync_id, event_type, severity, message, details, timestamp::text
        FROM connector_sync_logs
        WHERE instance_id = ${id}
          AND workspace_id = ${workspaceId}
          ${severity ? sql`AND severity = ${severity}` : sql``}
          ${cursor ? sql`AND id < ${cursor}` : sql``}
        ORDER BY timestamp DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id, syncId: r.sync_id, eventType: r.event_type,
        severity: r.severity, message: r.message, details: r.details, timestamp: r.timestamp,
      }));

      return c.json({
        data: items,
        meta: { hasMore, nextCursor: hasMore ? items[items.length - 1]?.id : undefined },
      });
    } catch (e) {
      log.error('Failed to get sync logs', { instanceId: id, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get sync logs' } }, 500);
    }
  });

  /** POST /api/v1/connectors/:id/health/retry — enqueue a manual retry sync */
  routes.post('/:id/health/retry', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = workspaceQuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const id = c.req.param('id');
    const { workspaceId } = parsed.data;

    try {
      const instance = await service.getInstance(id, workspaceId);
      if (!instance) {
        return c.json({ error: { code: 'NOT_FOUND', message: `Connector instance "${id}" not found` } }, 404);
      }

      if (syncQueue) {
        await syncQueue.enqueueSync(id, workspaceId);
      }

      const syncId = `retry-${Date.now()}`;
      await sql`
        INSERT INTO connector_sync_logs (instance_id, workspace_id, sync_id, event_type, severity, message)
        VALUES (${id}, ${workspaceId}, ${syncId}, 'retry', 'info', 'Manual retry triggered via dashboard')
      `;

      log.info('Manual connector retry enqueued', { instanceId: id, workspaceId });
      return c.json({ data: { instanceId: id, syncId, queued: !!syncQueue } }, 202);
    } catch (e) {
      log.error('Failed to enqueue retry', { instanceId: id, error: e });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to enqueue retry' } }, 500);
    }
  });

  return routes;
}

/** Backward-compatible export for routes that don't need persistence (e.g., manifest listing only) */
export const connectorRoutes = new Hono();
connectorRoutes.get('/', (c) => {
  const manifests: ConnectorManifest[] = registry.list();
  return c.json({ data: manifests });
});
connectorRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const manifest = registry.get(id);
  if (!manifest) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Connector "${id}" not found` } }, 404);
  }
  return c.json({ data: manifest });
});
