# Connector Review Skill

When triggered (e.g., "review this connector", "check my connector implementation"), perform the following review:

## Checklist

### Interface Compliance
- [ ] Extends `BaseConnector` correctly
- [ ] All abstract methods implemented: `connect()`, `sync()`, `getSchema()`, `healthCheck()`
- [ ] `ConnectorManifest` exported with all required fields

### Entity Transformation
- [ ] Raw API responses are transformed to `SemanticEntity` format (never returned raw)
- [ ] All entities include: `id`, `type`, `label`, `attributes`, `relationships`, `lastModified`, `sourceId`
- [ ] Entity IDs follow `<connector>:<type>:<externalId>` format
- [ ] Relationships use valid `targetId` references (not raw foreign keys)

### Sync Implementation
- [ ] Uses cursor-based pagination (not offset)
- [ ] Implements incremental sync (respects `lastSyncedAt`)
- [ ] Uses generator pattern (not buffering all records in memory)
- [ ] Applies rate limiting via `p-limit`
- [ ] Retries on 429/5xx with exponential backoff

### Error Handling
- [ ] Auth errors wrapped in `ConnectorError` with `retryable: false`
- [ ] Rate limit errors wrapped with `retryable: true`
- [ ] No silent error swallowing
- [ ] Timeout set on all HTTP calls (≤10s)

### Tests
- [ ] Test file exists at `src/__tests__/connector.test.ts`
- [ ] All HTTP mocked with MSW
- [ ] Covers: connect success, connect failure, sync pagination, healthCheck
- [ ] Fixture data in `tests/fixtures/<name>/`

## Output Format

Provide a summary of: passed checks, failed checks (with specific line references), and recommended fixes.
