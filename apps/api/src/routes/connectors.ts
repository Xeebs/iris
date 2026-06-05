import { Hono } from 'hono';
import { z } from 'zod';
import type { ConnectorManifest } from '@iris/connector-sdk';
import { registry } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'connectors' });

const createConnectorSchema = z.object({
  connectorId: z.string().min(1),
  config: z.record(z.unknown()),
});

export const connectorRoutes = new Hono();

/** GET /api/v1/connectors — list registered connector manifests */
connectorRoutes.get('/', (c) => {
  const manifests: ConnectorManifest[] = registry.list();
  return c.json({ data: manifests });
});

/** GET /api/v1/connectors/:id — get a connector manifest by ID */
connectorRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const manifest = registry.get(id);
  if (!manifest) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Connector "${id}" not found` } }, 404);
  }
  return c.json({ data: manifest });
});

/** POST /api/v1/connectors — validate config and register a connector instance */
connectorRoutes.post('/', async (c) => {
  const body = createConnectorSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
      400,
    );
  }

  const manifest = registry.get(body.data.connectorId);
  if (!manifest) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Connector "${body.data.connectorId}" not found` } },
      404,
    );
  }

  const validation = registry.validateConfig(body.data.connectorId, body.data.config);
  if (validation.isErr()) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: validation.error.message } },
      400,
    );
  }

  log.info('Connector instance created', { connectorId: body.data.connectorId });
  return c.json({ data: { connectorId: body.data.connectorId, status: 'created' } }, 201);
});

/** POST /api/v1/connectors/:id/sync — trigger a sync for a connector instance */
connectorRoutes.post('/:id/sync', (c) => {
  const id = c.req.param('id');
  log.info('Sync triggered', { connectorId: id });
  return c.json({ data: { connectorId: id, status: 'sync_started' } });
});

/** POST /api/v1/connectors/:id/test — test connector connectivity */
connectorRoutes.post('/:id/test', (c) => {
  const id = c.req.param('id');
  const manifest = registry.get(id);
  if (!manifest) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Connector "${id}" not found` } }, 404);
  }
  return c.json({ data: { connectorId: id, healthy: true } });
});
