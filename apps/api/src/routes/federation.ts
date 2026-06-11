import { Hono } from 'hono';
import { z } from 'zod';
import {
  registerFederatedWorkspace,
  getFederatedRelationships,
  queryFederatedContext,
  auditFederatedAccess,
  getFederationAuditLog,
  revokeFederatedWorkspace,
} from '@iris/semantic-core/federation-manager';
import { logger } from '@iris/core/logger';
import { randomUUID } from 'crypto';

const log = logger.child({ route: 'federation' });

const RegisterSchema = z.object({
  targetWorkspaceId: z.string().min(1),
  relationshipType: z.enum(['parent_child', 'sibling', 'partner']),
  permissions: z.array(z.object({
    entityTypePattern: z.string().min(1),
    canRead: z.boolean().default(true),
    canWrite: z.boolean().default(false),
  })).default([{ entityTypePattern: '*', canRead: true, canWrite: false }]),
});

const QuerySchema = z.object({
  query: z.string().min(1).max(2000),
  targetWorkspaceIds: z.array(z.string().min(1)).min(1).max(10),
  maxTokenBudget: z.number().int().min(100).max(8000).default(2000),
});

export function createFederationRoutes(sql: Parameters<typeof registerFederatedWorkspace>[0]) {
  const app = new Hono();

  /** POST /federation/workspaces — register federated relationship */
  app.post('/workspaces', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const userId = c.req.header('x-user-id') ?? 'system';
    const body = await c.req.json().catch(() => ({}));
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
    }

    const { targetWorkspaceId, relationshipType, permissions } = parsed.data;
    if (targetWorkspaceId === workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Cannot federate with self' } }, 400);
    }

    const result = await registerFederatedWorkspace(sql, workspaceId, targetWorkspaceId, relationshipType, permissions, userId);
    if (result.isErr()) {
      log.error('Failed to register federated workspace', { error: result.error.message });
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to register federation' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /federation/workspaces — list federated relationships */
  app.get('/workspaces', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const result = await getFederatedRelationships(sql, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load relationships' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /federation/workspaces/:targetWorkspaceId — revoke federation */
  app.delete('/workspaces/:targetWorkspaceId', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const targetWorkspaceId = c.req.param('targetWorkspaceId');
    const result = await revokeFederatedWorkspace(sql, workspaceId, targetWorkspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to revoke federation' } }, 500);
    }
    return c.json({ data: { revoked: true } });
  });

  /** POST /federation/query — query across federated workspaces */
  app.post('/query', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = await c.req.json().catch(() => ({}));
    const parsed = QuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
    }

    const { query, targetWorkspaceIds, maxTokenBudget } = parsed.data;
    const result = await queryFederatedContext(sql, query, workspaceId, targetWorkspaceIds, maxTokenBudget);

    if (result.isErr()) {
      log.error('Federated query failed', { error: result.error.message });
      return c.json({ error: { code: 'QUERY_ERROR', message: 'Federated query failed' } }, 500);
    }

    const queryId = randomUUID();
    if (result.value.queriedWorkspaces.length > 0) {
      await auditFederatedAccess(sql, queryId, workspaceId, result.value.queriedWorkspaces, result.value.entities.length).catch(() => undefined);
    }

    return c.json({ data: { queryId, ...result.value } });
  });

  /** GET /federation/audit — federation access audit log */
  app.get('/audit', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const limitStr = c.req.query('limit') ?? '50';
    const limit = Math.min(parseInt(limitStr, 10) || 50, 200);
    const result = await getFederationAuditLog(sql, workspaceId, limit);
    if (result.isErr()) {
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load audit log' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
