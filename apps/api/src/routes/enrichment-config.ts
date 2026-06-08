import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'enrichment-config' });
type SqlClient = ReturnType<typeof postgres>;

const configureSourceSchema = z.object({
  name: z.string().min(1).max(100),
  apiEndpoint: z.string().url().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  rateLimitRps: z.number().int().min(1).max(1000).optional(),
});

/**
 * REST routes for managing enrichment source configuration and triggering enrichment.
 * Base path: /api/v1/enrichments
 *
 * @param sql - Postgres client
 */
export function createEnrichmentConfigRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /enrichments — list all enrichment sources with status */
  app.get('/', async (c) => {
    try {
      const rows = await sql<
        {
          source_id: string;
          name: string;
          api_endpoint: string | null;
          enabled: boolean;
          rate_limit_rps: number;
          created_at: Date;
          updated_at: Date;
          entity_count: string;
          last_enriched_at: Date | null;
        }[]
      >`
        SELECT
          es.source_id,
          es.name,
          es.api_endpoint,
          es.enabled,
          es.rate_limit_rps,
          es.created_at,
          es.updated_at,
          COUNT(DISTINCT ee.entity_id)::text AS entity_count,
          MAX(ee.added_at) AS last_enriched_at
        FROM enrichment_sources es
        LEFT JOIN entity_enrichments ee ON ee.enrichment_source = es.source_id
        GROUP BY es.source_id
        ORDER BY es.name
      `;

      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to list enrichment sources', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list sources' } }, 500);
    }
  });

  /** GET /enrichments/sources/:sourceId — get single source config */
  app.get('/sources/:sourceId', async (c) => {
    const { sourceId } = c.req.param();
    try {
      const [row] = await sql`
        SELECT source_id, name, api_endpoint, enabled, rate_limit_rps, created_at, updated_at
        FROM enrichment_sources
        WHERE source_id = ${sourceId}
      `;
      if (!row) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Source not found' } }, 404);
      }
      return c.json({ data: row });
    } catch (e) {
      log.error('Failed to get enrichment source', { sourceId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get source' } }, 500);
    }
  });

  /** POST /enrichments/configure/:sourceId — create or update source configuration */
  app.post('/configure/:sourceId', async (c) => {
    const { sourceId } = c.req.param();
    const body = await c.req.json().catch(() => null);
    const parsed = configureSourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } }, 400);
    }

    const { name, apiEndpoint, apiKey, enabled, rateLimitRps } = parsed.data;

    try {
      const encryptedKey = apiKey ? Buffer.from(apiKey).toString('base64') : null;

      await sql`
        INSERT INTO enrichment_sources (source_id, name, api_endpoint, api_key_encrypted, enabled, rate_limit_rps)
        VALUES (
          ${sourceId},
          ${name},
          ${apiEndpoint ?? null},
          ${encryptedKey},
          ${enabled ?? true},
          ${rateLimitRps ?? 5}
        )
        ON CONFLICT (source_id) DO UPDATE SET
          name = EXCLUDED.name,
          api_endpoint = COALESCE(EXCLUDED.api_endpoint, enrichment_sources.api_endpoint),
          api_key_encrypted = COALESCE(EXCLUDED.api_key_encrypted, enrichment_sources.api_key_encrypted),
          enabled = COALESCE(EXCLUDED.enabled, enrichment_sources.enabled),
          rate_limit_rps = COALESCE(EXCLUDED.rate_limit_rps, enrichment_sources.rate_limit_rps),
          updated_at = NOW()
      `;

      log.info('Enrichment source configured', { sourceId });
      return c.json({ data: { sourceId, configured: true } }, 200);
    } catch (e) {
      log.error('Failed to configure enrichment source', { sourceId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to configure source' } }, 500);
    }
  });

  /** GET /enrichments/entities/:entityId — get all enrichment data for an entity */
  app.get('/entities/:entityId', async (c) => {
    const { entityId } = c.req.param();
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const rows = await sql`
        SELECT
          ee.enrichment_source,
          ee.enrichment_data,
          ee.confidence_score,
          ee.added_at,
          ee.expires_at,
          ee.refresh_triggered_at,
          es.name AS source_name
        FROM entity_enrichments ee
        JOIN enrichment_sources es ON es.source_id = ee.enrichment_source
        WHERE ee.entity_id = ${entityId} AND ee.workspace_id = ${workspaceId}::uuid
        ORDER BY ee.added_at DESC
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to get entity enrichments', { entityId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get enrichments' } }, 500);
    }
  });

  /** POST /enrichments/refresh/:entityId — force-refresh stale enrichment data */
  app.post('/refresh/:entityId', async (c) => {
    const { entityId } = c.req.param();
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      await sql`
        UPDATE entity_enrichments
        SET expires_at = NOW() - INTERVAL '1 second', refresh_triggered_at = NOW()
        WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}::uuid
      `;

      log.info('Entity enrichment refresh triggered', { entityId, workspaceId });
      return c.json({ data: { entityId, refreshTriggered: true } });
    } catch (e) {
      log.error('Failed to trigger enrichment refresh', { entityId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to trigger refresh' } }, 500);
    }
  });

  /** GET /enrichments/coverage — enrichment coverage stats per source */
  app.get('/coverage', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    }

    try {
      const rows = await sql`
        SELECT
          es.source_id,
          es.name,
          COUNT(DISTINCT ee.entity_id)::int AS enriched_entity_count,
          AVG(ee.confidence_score)::numeric(4,3) AS avg_confidence,
          MAX(ee.added_at) AS last_enriched_at
        FROM enrichment_sources es
        LEFT JOIN entity_enrichments ee
          ON ee.enrichment_source = es.source_id
          AND ee.workspace_id = ${workspaceId}::uuid
        WHERE es.enabled = true
        GROUP BY es.source_id, es.name
        ORDER BY es.name
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to get enrichment coverage', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get coverage' } }, 500);
    }
  });

  return app;
}
