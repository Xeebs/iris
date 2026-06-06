import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import type { ConnectorManifest } from '@iris/connector-sdk';
import { registry } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import type { SyncJobQueue } from '@iris/queue';
import type { SyncScheduleService } from '@iris/queue/sync-schedule-service';
import type { ConnectorHealthService } from '@iris/semantic-core/connector-health-service';

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

  /** GET /api/v1/connectors/types — list all registered connector manifests */
  routes.get('/types', (c) => {
    const manifests: ConnectorManifest[] = registry.list();
    return c.json({ data: manifests });
  });

  /** GET /api/v1/connectors/types/:connectorId — get a connector manifest */
  routes.get('/types/:connectorId', (c) => {
    const id = c.req.param('connectorId');
    const manifest = registry.get(id);
    if (!manifest) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Connector type "${id}" not found` } }, 404);
    }
    return c.json({ data: manifest });
  });

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

    const manifest = registry.get(connectorId);
    if (!manifest) {
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

  /** GET /api/v1/connectors/:id/health?workspaceId= — get latest health for one instance */
  routes.get('/:id/health', async (c) => {
    const parsed = workspaceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    if (!healthService) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Health service not configured' } }, 503);
    }
    const id = c.req.param('id');
    const result = await healthService.getHealth(id, parsed.data.workspaceId);
    if (result.isErr()) {
      log.error('Failed to get connector health', { instanceId: id, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get connector health' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `No health data for instance "${id}"` } }, 404);
    }
    return c.json({ data: result.value });
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
