import { registry } from '@iris/connector-sdk';
import { HubSpotConnector, manifest as hubspotManifest } from '@iris/connector-hubspot';
import { PostgresConnector, manifest as postgresManifest } from '@iris/connector-postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'connector-registration' });

/**
 * Register all built-in connectors in the shared process registry.
 * Idempotent — both the API server and the sync worker call this at startup
 * (without it the registry is empty and registry.get() throws on every
 * connector route and sync job).
 */
export function registerConnectors(): void {
  if (!registry.has(hubspotManifest.id)) {
    registry.register({
      manifest: hubspotManifest,
      factory: () => new HubSpotConnector(),
    });
  }
  if (!registry.has(postgresManifest.id)) {
    registry.register({
      manifest: postgresManifest,
      factory: () => new PostgresConnector(),
    });
  }
  log.info('Connectors registered', { count: registry.size });
}
