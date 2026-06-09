import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { EnterpriseSsoService } from '../auth/enterprise-sso.js';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'sso-config' });
type SqlClient = ReturnType<typeof postgres>;

const upsertSchema = z.object({
  provider: z.enum(['saml', 'oidc']),
  providerName: z.string().min(1).max(100),
  metadataUrl: z.string().url().optional().nullable(),
  entityId: z.string().optional().nullable(),
  acsUrl: z.string().url().optional().nullable(),
  issuer: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  attributeMappings: z.record(z.string()).optional(),
});

const samlAssertionSchema = z.object({
  nameId: z.string().min(1),
  attributes: z.record(z.union([z.string(), z.array(z.string())])),
  issuer: z.string().min(1),
});

const oidcClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().optional(),
  groups: z.array(z.string()).optional(),
  iss: z.string().min(1),
});

/**
 * Routes for Enterprise SSO configuration and user provisioning.
 * Exposes CRUD for SSO provider configs and SAML/OIDC assertion handling.
 *
 * @param sql - Postgres client
 */
export function createSsoConfigRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const getSvc = () => new EnterpriseSsoService(sql);

  /** GET /sso — list all SSO configurations for the workspace */
  app.get('/', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await getSvc().listConfigurations(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** GET /sso/:provider — get single provider config */
  app.get('/:provider', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const providerParsed = z.enum(['saml', 'oidc']).safeParse(c.req.param('provider'));
    if (!providerParsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid provider' } }, 400);
    const result = await getSvc().getConfiguration(workspaceId, providerParsed.data);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    if (!result.value) return c.json({ error: { code: 'NOT_FOUND', message: 'SSO configuration not found' } }, 404);
    return c.json({ data: result.value });
  });

  /** POST /sso — create or update SSO configuration */
  app.post('/', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const { provider, providerName, attributeMappings = {}, ...rest } = parsed.data;
    const result = await getSvc().upsertConfiguration(workspaceId, provider, providerName, rest as Parameters<ReturnType<typeof getSvc>['upsertConfiguration']>[3], attributeMappings);
    if (result.isErr()) {
      log.error('Failed to upsert SSO config', { workspaceId, provider, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** POST /sso/provision/saml — JIT provision from SAML assertion */
  app.post('/provision/saml', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ assertion: samlAssertionSchema, mappings: z.record(z.string()).optional() }).safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

    const valid = await getSvc().validateSamlIssuer(workspaceId, parsed.data.assertion);
    if (!valid) return c.json({ error: { code: 'INVALID_ISSUER', message: 'SAML issuer does not match configured entity ID' } }, 403);

    const result = await getSvc().provisionFromSaml(workspaceId, parsed.data.assertion, parsed.data.mappings ?? {});
    if (result.isErr()) return c.json({ error: { code: 'PROVISION_ERROR', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  /** POST /sso/provision/oidc — JIT provision from OIDC claims */
  app.post('/provision/oidc', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = oidcClaimsSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await getSvc().provisionFromOidc(workspaceId, parsed.data as Parameters<ReturnType<typeof getSvc>['provisionFromOidc']>[1]);
    if (result.isErr()) return c.json({ error: { code: 'PROVISION_ERROR', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  /** GET /sso/users — list SSO-provisioned users */
  app.get('/users', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await getSvc().listSsoUsers(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
