import { Hono } from 'hono';
import { z } from 'zod';
import { ToolVersionManager } from '@iris/semantic-core/mcp-tool-versioning';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'mcp-tools' });

const registerVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+$/, 'Version must be MAJOR.MINOR'),
  schemaJson: z.record(z.unknown()),
  handlerRef: z.string().min(1),
});

const deprecateVersionSchema = z.object({
  sunsetDate: z.string().datetime(),
  message: z.string().min(1),
});

/**
 * @param sql - Tagged template SQL function
 * @returns Hono router mounted at /api/v1/mcp-tools
 */
export function createMcpToolsRoutes(sql: SqlFn) {
  const app = new Hono();
  const manager = new ToolVersionManager(sql);

  // GET / — list all tools with latest version
  app.get('/', async (c) => {
    const result = await manager.listAllTools();
    if (result.isErr()) {
      log.error('Failed to list tools', { error: result.error.message });
      return c.json({ error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /:toolName/versions — list all versions for a tool
  app.get('/:toolName/versions', async (c) => {
    const toolName = c.req.param('toolName');
    const result = await manager.listVersions(toolName);
    if (result.isErr()) {
      return c.json({ error: { code: 'VERSIONS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // POST /:toolName/versions — register a new version
  app.post('/:toolName/versions', async (c) => {
    const toolName = c.req.param('toolName');
    const body = await c.req.json().catch(() => null) as unknown;
    const parsed = registerVersionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' } }, 400);
    }
    const result = await manager.registerToolVersion(toolName, parsed.data.version, parsed.data.schemaJson, parsed.data.handlerRef);
    if (result.isErr()) {
      log.error('Failed to register version', { toolName, error: result.error.message });
      return c.json({ error: { code: 'REGISTER_FAILED', message: result.error.message } }, 400);
    }
    log.info('Tool version registered', { toolName, version: parsed.data.version });
    return c.json({ data: result.value }, 201);
  });

  // POST /:toolName/versions/:version/deprecate — deprecate a version
  app.post('/:toolName/versions/:version/deprecate', async (c) => {
    const toolName = c.req.param('toolName');
    const version = c.req.param('version');
    const body = await c.req.json().catch(() => null) as unknown;
    const parsed = deprecateVersionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' } }, 400);
    }
    const result = await manager.deprecateVersion(toolName, version, new Date(parsed.data.sunsetDate), parsed.data.message);
    if (result.isErr()) {
      return c.json({ error: { code: 'DEPRECATE_FAILED', message: result.error.message } }, 500);
    }
    log.warn('Tool version deprecated via API', { toolName, version });
    return c.json({ data: result.value }, 201);
  });

  // DELETE /:toolName/versions/:version — deactivate a version
  app.delete('/:toolName/versions/:version', async (c) => {
    const toolName = c.req.param('toolName');
    const version = c.req.param('version');
    const result = await manager.deactivateVersion(toolName, version);
    if (result.isErr()) {
      return c.json({ error: { code: 'DEACTIVATE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { deactivated: true } });
  });

  // GET /:toolName/resolve — resolve handler for a client version
  app.get('/:toolName/resolve', async (c) => {
    const toolName = c.req.param('toolName');
    const clientVersion = c.req.query('clientVersion') ?? '1.0';
    const result = await manager.resolveHandler(toolName, clientVersion);
    if (result.isErr()) {
      return c.json({ error: { code: 'RESOLVE_FAILED', message: result.error.message } }, 404);
    }
    return c.json({ data: result.value });
  });

  // GET /:toolName/sdk-stub — generate SDK stub
  app.get('/:toolName/sdk-stub', async (c) => {
    const toolName = c.req.param('toolName');
    const rawLang = c.req.query('language') ?? 'typescript';
    const language = rawLang === 'python' ? 'python' : 'typescript';
    const version = c.req.query('version');
    const result = await manager.generateClientSdkStub(toolName, language, version);
    if (result.isErr()) {
      return c.json({ error: { code: 'SDK_STUB_FAILED', message: result.error.message } }, 404);
    }
    return c.json({ data: result.value });
  });

  return app;
}
