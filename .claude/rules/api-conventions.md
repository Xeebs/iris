# API Design Conventions

## REST API

- Base path: `/api/v1/`
- All routes are kebab-case: `/api/v1/connector-instances`, not `/api/v1/connectorInstances`
- Resource naming: plural nouns (`/connectors`, `/entities`, `/queries`)
- Actions on resources: POST to sub-resource (`/connectors/:id/sync`, `/connectors/:id/test`)

## Request / Response Format

All responses follow this envelope:

```typescript
// Success
{ "data": T, "meta"?: PaginationMeta }

// Error  
{ "error": { "code": string, "message": string, "details"?: unknown } }
```

## Pagination

- Cursor-based only: `?cursor=<opaque_string>&limit=<number>`
- Default limit: 50, max: 200
- Response includes `meta.nextCursor` and `meta.hasMore`

## HTTP Status Codes

- `200` — success
- `201` — resource created
- `400` — validation error (zod errors go here)
- `401` — unauthenticated
- `403` — unauthorized (authenticated but lacks permission)
- `404` — resource not found
- `409` — conflict (e.g., duplicate connector)
- `422` — business logic error (not a validation error)
- `429` — rate limited
- `500` — unexpected server error (never leak stack traces)

## MCP API (separate from REST)

MCP tools follow these conventions:
- Tool names: verb-noun (`query-context`, `list-entities`, `get-metric`)
- All tool inputs validated with zod schema
- All tools return `{ content: [{ type: 'text', text: string }] }`
- Token budget respected: if response would exceed budget, truncate with a `truncated: true` flag
- Tools never throw — return error as structured content

## Authentication

- REST API: Bearer JWT (issued by Clerk)
- MCP server: API key (scoped to workspace + permission set)
- Connector OAuth tokens: stored encrypted, never returned to clients
