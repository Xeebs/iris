/**
 * Connector Registry — maps connector IDs to their manifest and factory function.
 *
 * Every connector built with /project:new-connector is automatically added here.
 * The MCP server and dashboard import this registry to know which connectors are
 * available and what configuration they require.
 *
 * @see .claude/rules/connector-patterns.md
 */

import type { ConnectorManifest, BaseConnector, SemanticEntity } from './base-connector.js';

export type ConnectorFactory<TConfig = unknown> = (
  config: TConfig,
) => BaseConnector<TConfig, SemanticEntity>;

export interface ConnectorRegistration {
  manifest: ConnectorManifest;
  factory: ConnectorFactory;
}

/** All registered connectors. Add entries here when scaffolding a new connector. */
const registry = new Map<string, ConnectorRegistration>();

export function registerConnector(registration: ConnectorRegistration): void {
  if (registry.has(registration.manifest.id)) {
    throw new Error(`Connector '${registration.manifest.id}' is already registered`);
  }
  registry.set(registration.manifest.id, registration);
}

export function getConnector(id: string): ConnectorRegistration {
  const reg = registry.get(id);
  if (!reg) throw new Error(`Connector '${id}' is not registered. Did you forget to register it?`);
  return reg;
}

export function listConnectors(): ConnectorManifest[] {
  return [...registry.values()].map((r) => r.manifest);
}

// ─── Built-in Connector Registrations ────────────────────────────────────────
// Connectors are registered here as they are implemented.
// Uncomment each line after the connector package is implemented.

// import { register as registerHubspot } from '@iris/connector-hubspot';
// import { register as registerSalesforce } from '@iris/connector-salesforce';
// import { register as registerNotion } from '@iris/connector-notion';
// import { register as registerSnowflake } from '@iris/connector-snowflake';
// import { register as registerPostgres } from '@iris/connector-postgres';
// import { register as registerGoogleDrive } from '@iris/connector-google-drive';

// registerHubspot();
// registerSalesforce();
// registerNotion();
// registerSnowflake();
// registerPostgres();
// registerGoogleDrive();
