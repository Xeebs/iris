export type {
  SemanticEntity,
  EntityRelationship,
  ConnectorSchema,
  EntityTypeSchema,
  AttributeSchema,
  AttributeValue,
  SyncOptions,
  HealthStatus,
  ConnectorManifest,
} from './base-connector.js';
export { ConnectorError, BaseConnector } from './base-connector.js';
export type { ConnectorFactory, ConnectorRegistration } from './registry.js';
export { ConnectorRegistry, registry } from './registry.js';
