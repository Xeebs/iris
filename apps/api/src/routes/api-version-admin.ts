import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import {
  ApiVersionManager,
  buildDeprecationHeaders,
} from '@iris/semantic-core/api-versioning';
import type { ApiVersion, EndpointVersion, VersionStatus } from '@iris/semantic-core/api-versioning';

const RegisterVersionSchema = z.object({
  version: z.string().regex(/^v\d+(\.\d+)?$/),
  status: z.enum(['active', 'deprecated', 'sunset']).default('active'),
  features: z.array(z.string()).default([]),
  sunsetAt: z.string().datetime().optional(),
});

const RegisterEndpointSchema = z.object({
  path: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  version: z.string().regex(/^v\d+(\.\d+)?$/),
  status: z.enum(['active', 'deprecated', 'sunset']).default('active'),
  sunsetAt: z.string().datetime().optional(),
  migrationPath: z.string().optional(),
});

export function makeApiVersionAdminRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();

  app.get('/', async (c) => {
    try {
      type VersionRow = { version: string; status: string; released_at: Date; sunset_at: Date | null; features: string[]; min_client_ver: string | null };
      const rows = await sql<VersionRow[]>`
        SELECT version, status, released_at, sunset_at, features, min_client_ver
        FROM api_versions ORDER BY released_at DESC
      `;
      return c.json({ data: rows });
    } catch (e) {
      return c.json({ error: { code: 'LIST_FAILED', message: String(e) } }, 500);
    }
  });

  app.post('/', async (c) => {
    const parsed = RegisterVersionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const { version, status, features, sunsetAt } = parsed.data;
    try {
      await sql`
        INSERT INTO api_versions (version, status, features, sunset_at)
        VALUES (${version}, ${status}, ${JSON.stringify(features)}, ${sunsetAt ?? null})
        ON CONFLICT (version) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, sunset_at = EXCLUDED.sunset_at
      `;
      return c.json({ data: { version, status } }, 201);
    } catch (e) {
      return c.json({ error: { code: 'CREATE_FAILED', message: String(e) } }, 500);
    }
  });

  app.get('/:version/deprecated', async (c) => {
    const version = c.req.param('version');
    try {
      type EndpointRow = { path: string; method: string; version: string; status: string; deprecated_at: Date | null; sunset_at: Date | null; migration_path: string | null };
      const rows = await sql<EndpointRow[]>`
        SELECT path, method, version, status, deprecated_at, sunset_at, migration_path
        FROM endpoint_versions
        WHERE version = ${version} AND status != 'active'
        ORDER BY path
      `;

      const mgr = new ApiVersionManager();
      const withHeaders = rows.map((r) => {
        const ep: EndpointVersion = {
          path: r.path,
          method: r.method,
          version: r.version,
          status: r.status as VersionStatus,
          deprecatedAt: r.deprecated_at,
          sunsetAt: r.sunset_at,
          migrationPath: r.migration_path,
        };
        return { ...ep, deprecationHeaders: buildDeprecationHeaders(ep) };
      });

      return c.json({ data: withHeaders });
    } catch (e) {
      return c.json({ error: { code: 'LIST_FAILED', message: String(e) } }, 500);
    }
  });

  app.post('/endpoints', async (c) => {
    const parsed = RegisterEndpointSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const { path, method, version, status, sunsetAt, migrationPath } = parsed.data;
    try {
      await sql`
        INSERT INTO endpoint_versions (path, method, version, status, sunset_at, migration_path)
        VALUES (${path}, ${method}, ${version}, ${status}, ${sunsetAt ?? null}, ${migrationPath ?? null})
        ON CONFLICT (path, method, version) DO UPDATE
          SET status = EXCLUDED.status, sunset_at = EXCLUDED.sunset_at, migration_path = EXCLUDED.migration_path
      `;
      return c.json({ data: { path, method, version, status } }, 201);
    } catch (e) {
      return c.json({ error: { code: 'CREATE_FAILED', message: String(e) } }, 500);
    }
  });

  return app;
}
