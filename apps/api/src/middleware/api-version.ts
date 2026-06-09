import type { Context, Next } from 'hono';
import { parseVersionHeader, ApiVersionManager } from '@iris/semantic-core/api-versioning';

const SUPPORTED_VERSIONS = ['v1', 'v2'];
const MIN_VERSION = 'v1';
const MAX_VERSION = 'v2';

const manager = new ApiVersionManager();
manager.defineVersion({ version: 'v1', status: 'deprecated', releasedAt: new Date('2026-01-01'), sunsetAt: new Date('2027-01-01'), features: ['entities', 'search', 'connectors'], minClientVersion: null });
manager.defineVersion({ version: 'v2', status: 'active', releasedAt: new Date('2026-06-01'), sunsetAt: null, features: ['entities', 'search', 'connectors', 'streaming', 'tracing', 'ha'], minClientVersion: null });

/**
 * Hono middleware that validates X-API-Version header, injects version into context,
 * and appends deprecation headers to responses for deprecated versions.
 */
export async function apiVersionMiddleware(c: Context, next: Next): Promise<void | Response> {
  const requestedVersion = parseVersionHeader(c.req.header('x-api-version'));
  const check = manager.checkVersionSupport(requestedVersion);

  if (!check.supported) {
    return c.json(
      { error: { code: 'API_VERSION_UNSUPPORTED', message: check.reason ?? `Version ${requestedVersion} is not supported` } },
      400,
    );
  }

  c.set('apiVersion', requestedVersion);

  await next();

  const version = manager.getVersion(requestedVersion);
  if (version?.status === 'deprecated') {
    c.header('Deprecation', version.releasedAt.toUTCString());
    if (version.sunsetAt) c.header('Sunset', version.sunsetAt.toUTCString());
    c.header('Warning', `299 iris "API version ${requestedVersion} is deprecated. Please upgrade to ${MAX_VERSION}."`);
  }
  return;
}

export { manager as versionManager, SUPPORTED_VERSIONS, MIN_VERSION, MAX_VERSION };
