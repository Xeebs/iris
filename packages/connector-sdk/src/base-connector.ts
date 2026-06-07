/**
 * BaseConnector — the interface every Iris data source connector must implement.
 *
 * Connectors are responsible for:
 * 1. Authenticating with the external system
 * 2. Syncing records as an async generator of SemanticEntity objects
 * 3. Reporting schema and health status
 *
 * @see .claude/rules/connector-patterns.md
 */

import type { Result } from 'neverthrow';
import type { ZodTypeAny } from 'zod';

// ─── Core Types ──────────────────────────────────────────────────────────────

/** Scalar attribute value. Arrays allowed for multi-value fields (tags, owners, categories). */
export type AttributeValue = string | number | boolean | string[] | null;

export interface SemanticEntity {
  /** Globally unique ID: `<connector>:<type>:<externalId>` */
  id: string;
  type: string;
  label: string;
  attributes: Record<string, AttributeValue>;
  relationships: EntityRelationship[];
  lastModified: Date;
  /** The raw external ID from the source system */
  sourceId: string;
}

export interface EntityRelationship {
  type: string;
  targetId: string;
  attributes?: Record<string, AttributeValue>;
}

export interface ConnectorSchema {
  entityTypes: EntityTypeSchema[];
  version: string;
}

export interface EntityTypeSchema {
  name: string;
  attributes: AttributeSchema[];
}

export interface AttributeSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'string[]';
  nullable: boolean;
  description?: string;
  pii?: boolean; // flag fields that may contain PII for masking
}

export interface SyncOptions {
  lastSyncedAt?: Date;
  entityTypes?: string[];
  limit?: number;
  cursor?: string;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  auth: { type: 'oauth2' | 'api-key' | 'basic'; scopes?: string[] };
  entityTypes: string[];
  /** Zod schema for the connector's workspace-level config (e.g., portalId, region) */
  configSchema: ZodTypeAny;
  rateLimits: { requestsPerSecond: number };
  /**
   * CDC strategies supported by this connector, in preference order.
   * Defaults to ['snapshot_diff'] if omitted (safest, no connector changes needed).
   */
  cdcStrategies?: ('cursor' | 'event_driven' | 'snapshot_diff')[];
}

// ─── Abstract Base ────────────────────────────────────────────────────────────

/**
 * All connectors extend BaseConnector<TConfig, TEntity>.
 *
 * TConfig  — workspace-specific configuration (validated via manifest.configSchema)
 * TEntity  — the specific SemanticEntity subtype this connector produces
 */
export abstract class BaseConnector<TConfig, TEntity extends SemanticEntity = SemanticEntity> {
  abstract connect(config: TConfig): Promise<Result<void, ConnectorError>>;
  abstract sync(options: SyncOptions): AsyncGenerator<TEntity>;
  abstract getSchema(): Promise<ConnectorSchema>;
  abstract healthCheck(): Promise<HealthStatus>;
}
