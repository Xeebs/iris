import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { SessionManager } from '@iris/core/session-manager';
import type { CreateSessionOptions } from '@iris/core/session-manager';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'sessions' });
type SqlClient = ReturnType<typeof postgres>;

const createSessionSchema = z.object({
  userId: z.string().min(1),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  browserName: z.string().optional(),
  osName: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  deviceFingerprint: z.string().optional(),
});

const trustDeviceSchema = z.object({
  fingerprint: z.string().min(1),
  deviceName: z.string().optional(),
});

/**
 * Routes for session management and device tracking.
 * Mounted under /api/v1/sessions.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createSessionRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const manager = new SessionManager(sql as ConstructorParameters<typeof SessionManager>[0]);

  /** GET /api/v1/sessions — list active sessions for the requesting user */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.req.query('userId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    if (!userId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'userId query param required' } }, 400);

    const result = await manager.getActiveSessions(userId, workspaceId);
    if (result.isErr()) {
      log.error('Failed to list sessions', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list sessions' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/sessions — create a session */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: z.infer<typeof createSessionSchema>;
    try { body = createSessionSchema.parse(await c.req.json()); }
    catch (e) { return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400); }

    const opts: CreateSessionOptions = { userId: body.userId, workspaceId };
    if (body.ipAddress !== undefined) opts.ipAddress = body.ipAddress;
    if (body.userAgent !== undefined) opts.userAgent = body.userAgent;
    if (body.browserName !== undefined) opts.browserName = body.browserName;
    if (body.osName !== undefined) opts.osName = body.osName;
    if (body.countryCode !== undefined) opts.countryCode = body.countryCode;
    if (body.deviceFingerprint !== undefined) opts.deviceFingerprint = body.deviceFingerprint;
    const result = await manager.createSession(opts);
    if (result.isErr()) {
      log.error('Failed to create session', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create session' } }, 500);
    }

    // Geo-anomaly detection: flag if new country
    if (body.countryCode) {
      const isNew = await manager.isNewCountry(body.userId, workspaceId, body.countryCode);
      if (isNew) {
        log.warn('New country login detected', { userId: body.userId, countryCode: body.countryCode });
      }
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /api/v1/sessions/:id/refresh — extend session expiry */
  app.post('/:id/refresh', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { id } = c.req.param();
    const result = await manager.refreshSession(id);
    if (result.isErr()) {
      if (result.error.message.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to refresh session' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/sessions/:id — revoke a session */
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { id } = c.req.param();
    const result = await manager.revokeSession(id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke session' } }, 500);
    }
    return c.json({ data: { revoked: true, id } });
  });

  /** GET /api/v1/sessions/devices — list trusted devices for a user */
  app.get('/devices', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.req.query('userId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    if (!userId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'userId query param required' } }, 400);

    const result = await manager.getTrustedDevices(userId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list devices' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/sessions/devices — trust a device */
  app.post('/devices', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.req.query('userId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    if (!userId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'userId query param required' } }, 400);

    let body: z.infer<typeof trustDeviceSchema>;
    try { body = trustDeviceSchema.parse(await c.req.json()); }
    catch (e) { return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400); }

    const result = await manager.trustDevice(userId, workspaceId, body.fingerprint, body.deviceName);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to trust device' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** DELETE /api/v1/sessions/devices/:deviceId — revoke device trust */
  app.delete('/devices/:deviceId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.req.query('userId');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    if (!userId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'userId query param required' } }, 400);

    const { deviceId } = c.req.param();
    const result = await manager.revokeDevice(deviceId, userId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke device' } }, 500);
    }
    return c.json({ data: { revoked: true, deviceId } });
  });

  return app;
}
