import { Hono } from 'hono';
import { z } from 'zod';
import {
  captureContextSnapshot,
  queryAsOfDate,
  diffContextVersions,
  listVersionHistory,
  rollbackToVersion,
} from '@iris/semantic-core/context-versioner';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'context-versioning' });

type Sql = Parameters<typeof captureContextSnapshot>[0];
type SqlBindings = { sql: Sql };

const app = new Hono<{ Bindings: SqlBindings }>();

function getSql(c: { env: unknown }) {
  return (c.env as SqlBindings | undefined)?.sql;
}

const CaptureSchema = z.object({
  snapshotKey: z.string().min(1).max(128).default(() => `snapshot-${Date.now()}`),
});

const QueryAsOfSchema = z.object({
  query: z.string().min(1).max(2000),
  targetDate: z.string().datetime(),
  contextBudget: z.number().int().min(100).max(8000).default(2000),
});

const RollbackSchema = z.object({
  versionId: z.string().uuid(),
  confirm: z.literal(true),
});

/** POST /context/snapshots — capture current context as snapshot */
app.post('/snapshots', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const body = await c.req.json().catch(() => ({}));
  const parsed = CaptureSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const sql = getSql(c);
  const result = await captureContextSnapshot(sql!, workspaceId, parsed.data.snapshotKey);
  if (result.isErr()) {
    log.error('Failed to capture snapshot', { error: result.error.message });
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to capture snapshot' } }, 500);
  }
  return c.json({ data: result.value }, 201);
});

/** GET /context/snapshots — list version history */
app.get('/snapshots', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const limitStr = c.req.query('limit') ?? '20';
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(limitStr, 10) || 20, 100);

  const sql = getSql(c);
  const result = await listVersionHistory(sql!, workspaceId, limit, cursor);
  if (result.isErr()) {
    return c.json({ error: { code: 'DB_ERROR', message: 'Failed to list versions' } }, 500);
  }
  return c.json({ data: result.value.entries, meta: { nextCursor: result.value.nextCursor, hasMore: result.value.hasMore } });
});

/** POST /context/query-as-of — query historical context */
app.post('/query-as-of', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const body = await c.req.json().catch(() => ({}));
  const parsed = QueryAsOfSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
  }

  const { query, targetDate, contextBudget } = parsed.data;
  const sql = getSql(c);
  const result = await queryAsOfDate(sql!, workspaceId, query, new Date(targetDate), contextBudget);
  if (result.isErr()) {
    log.error('Historical query failed', { error: result.error.message });
    return c.json({ error: { code: 'QUERY_ERROR', message: 'Historical query failed' } }, 500);
  }
  return c.json({ data: result.value });
});

/** GET /context/versions/:id/diff — compare two snapshots */
app.get('/versions/:id/diff', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const fromVersionId = c.req.param('id');
  const toVersionId = c.req.query('toVersion');
  if (!toVersionId) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'toVersion query parameter is required' } }, 400);
  }

  const sql = getSql(c);
  const result = await diffContextVersions(sql!, workspaceId, fromVersionId, toVersionId);
  if (result.isErr()) {
    return c.json({ error: { code: 'DIFF_ERROR', message: result.error.message } }, 422);
  }
  return c.json({ data: result.value });
});

/** POST /context/rollback — rollback to a previous version (admin only) */
app.post('/rollback', async (c) => {
  const workspaceId = c.req.header('x-workspace-id') ?? 'default';
  const userId = c.req.header('x-user-id') ?? 'system';
  const body = await c.req.json().catch(() => ({}));
  const parsed = RollbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Rollback requires versionId (UUID) and confirm: true', details: parsed.error.format() } }, 400);
  }

  const sql = getSql(c);
  const result = await rollbackToVersion(sql!, workspaceId, parsed.data.versionId, userId);
  if (result.isErr()) {
    log.error('Rollback failed', { error: result.error.message, workspaceId, versionId: parsed.data.versionId });
    return c.json({ error: { code: 'ROLLBACK_ERROR', message: result.error.message } }, 422);
  }
  return c.json({ data: result.value });
});

export default app;
