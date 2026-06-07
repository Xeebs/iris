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
export class ConnectorError extends Error {
    code;
    retryable;
    cause;
    constructor(message, code, retryable, cause) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.cause = cause;
        this.name = 'ConnectorError';
    }
}
// ─── Abstract Base ────────────────────────────────────────────────────────────
/**
 * All connectors extend BaseConnector<TConfig, TEntity>.
 *
 * TConfig  — workspace-specific configuration (validated via manifest.configSchema)
 * TEntity  — the specific SemanticEntity subtype this connector produces
 */
export class BaseConnector {
}
//# sourceMappingURL=base-connector.js.map