# Connector Implementation Patterns

## The BaseConnector Contract

Every connector must extend `BaseConnector<TConfig, TEntity>` and implement all four abstract methods:

```typescript
// packages/connector-sdk/src/base-connector.ts
abstract class BaseConnector<TConfig, TEntity extends SemanticEntity = SemanticEntity> {
  abstract connect(config: TConfig): Promise<Result<void, ConnectorError>>;
  abstract sync(options: SyncOptions): AsyncGenerator<TEntity>;   // sync generator, NOT Promise<AsyncGenerator>
  abstract getSchema(): Promise<ConnectorSchema>;
  abstract healthCheck(): Promise<HealthStatus>;
}
```

Note: `sync()` is a direct `AsyncGenerator`, not wrapped in `Promise`. Use `async function*` syntax.

## Entity Transformation (Critical)

**Never** return raw API responses as context. Always transform to `SemanticEntity`:

```typescript
// BAD — raw HubSpot contact object (3KB+)
return hubspotContact;

// GOOD — semantic entity (compact, meaningful)
return {
  id: `hubspot:contact:${contact.id}`,
  type: 'contact',
  label: `${contact.firstname} ${contact.lastname}`,
  attributes: {
    email: contact.email,
    company: contact.company,
    stage: contact.lifecyclestage,
    owner: contact.hubspot_owner_id,
  },
  relationships: [
    { type: 'belongs_to', targetId: `hubspot:company:${contact.associatedcompanyid}` }
  ],
  lastModified: contact.lastmodifieddate,
  sourceId: `hubspot:contact:${contact.id}`,
};
```

## Sync Patterns

- Use cursor-based pagination, never offset-based (offset breaks on live data)
- Implement incremental sync: store `lastSyncedAt` cursor per connector instance
- Yield entities as a generator — don't buffer everything in memory
- Rate limiting: use `p-limit` with connector-specific concurrency limits
- Retry with exponential backoff on 429 and 5xx errors (max 3 retries)

## OAuth Connectors

- Store OAuth tokens encrypted at rest (AES-256-GCM)
- Implement automatic token refresh before expiry (refresh if `expiresAt - now < 5min`)
- Handle token revocation gracefully: emit `ConnectorEvent.AUTH_REVOKED`

## Connector Manifest

Every connector exports a `ConnectorManifest`:

```typescript
export const manifest: ConnectorManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, companies, deals, and activities',
  icon: 'hubspot.svg',
  auth: { type: 'oauth2', scopes: ['contacts', 'crm.objects.deals.read'] },
  entityTypes: ['contact', 'company', 'deal', 'activity'],
  configSchema: z.object({ portalId: z.string() }),  // validated at connector setup time
  rateLimits: { requestsPerSecond: 10 },
};

// configSchema is required on all manifests. For API-key connectors, include the key field:
// configSchema: z.object({ apiKey: z.string().min(1) })
// For connectors with no extra config: z.object({})
```

## Testing Connectors

- Mock all HTTP with `msw` (Mock Service Worker) — no real API calls in tests
- Fixture files in `tests/fixtures/<connector>/` — one file per entity type
- Test: `connect()` success, `connect()` auth failure, `sync()` pagination, `sync()` partial failure, `healthCheck()`
