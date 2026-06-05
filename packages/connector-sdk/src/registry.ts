import type { ConnectorManifest, BaseConnector, SemanticEntity } from './base-connector.js';
import { ConnectorError } from './base-connector.js';

export type ConnectorFactory<TConfig = unknown> = (
  config: TConfig,
) => BaseConnector<TConfig, SemanticEntity>;

export interface ConnectorRegistration<TConfig = unknown> {
  manifest: ConnectorManifest;
  factory: ConnectorFactory<TConfig>;
}

/**
 * Registry of all installed connector manifests and their factories.
 * Instantiate once at startup and share across the process.
 */
export class ConnectorRegistry {
  private readonly registrations = new Map<string, ConnectorRegistration>();

  /**
   * Register a connector manifest and its factory function.
   * Throws if a connector with the same id has already been registered.
   */
  register<TConfig>(registration: ConnectorRegistration<TConfig>): void {
    const { id } = registration.manifest;
    if (this.registrations.has(id)) {
      throw new ConnectorError(
        `Connector '${id}' is already registered`,
        'DUPLICATE_CONNECTOR',
        false,
      );
    }
    this.registrations.set(id, registration as ConnectorRegistration);
  }

  /**
   * Look up a registered connector by id.
   * Throws ConnectorError if not found.
   */
  get(id: string): ConnectorRegistration {
    const reg = this.registrations.get(id);
    if (!reg) {
      throw new ConnectorError(
        `Connector '${id}' is not registered`,
        'CONNECTOR_NOT_FOUND',
        false,
      );
    }
    return reg;
  }

  /** List manifests for all registered connectors. */
  list(): ConnectorManifest[] {
    return [...this.registrations.values()].map((r) => r.manifest);
  }

  /**
   * Validate a raw config object against the connector's configSchema.
   * Returns the parsed (coerced) config on success.
   * Throws ConnectorError with details on validation failure.
   */
  validateConfig(connectorId: string, rawConfig: unknown): unknown {
    const reg = this.get(connectorId);
    const result = reg.manifest.configSchema.safeParse(rawConfig);
    if (!result.success) {
      const issues = result.error.issues
        .map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new ConnectorError(
        `Invalid config for connector '${connectorId}': ${issues}`,
        'INVALID_CONFIG',
        false,
      );
    }
    return result.data;
  }

  /** True if a connector with this id has been registered. */
  has(id: string): boolean {
    return this.registrations.has(id);
  }

  /** Number of registered connectors. */
  get size(): number {
    return this.registrations.size;
  }
}

/** Shared singleton registry for the process. */
export const registry = new ConnectorRegistry();
