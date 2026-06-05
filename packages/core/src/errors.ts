import { ok, err } from 'neverthrow';
export { ok, err };
export type { Result } from 'neverthrow';

/** Base class for all Iris errors. Carries a human-readable code for client display. */
export class IrisError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IrisError';
  }
}

/** Errors originating from a connector (OAuth, API, rate limit). */
export class ConnectorError extends IrisError {
  constructor(
    message: string,
    public readonly retryable: boolean,
    cause?: unknown,
  ) {
    super('CONNECTOR_ERROR', message, cause);
    this.name = 'ConnectorError';
  }
}

/** Errors from the semantic indexing pipeline (embedding, storage). */
export class IndexerError extends IrisError {
  constructor(message: string, cause?: unknown) {
    super('INDEXER_ERROR', message, cause);
    this.name = 'IndexerError';
  }
}

/** Errors from the semantic or prefix cache. */
export class CacheError extends IrisError {
  constructor(message: string, cause?: unknown) {
    super('CACHE_ERROR', message, cause);
    this.name = 'CacheError';
  }
}

/** Errors originating from MCP tool execution. */
export class MCPError extends IrisError {
  constructor(message: string, cause?: unknown) {
    super('MCP_ERROR', message, cause);
    this.name = 'MCPError';
  }
}
