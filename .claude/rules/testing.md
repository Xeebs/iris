# Testing Conventions

## Framework

- Unit + integration tests: **Vitest** (faster than Jest, native ESM)
- E2E tests: **Playwright**
- API mocking: **MSW (Mock Service Worker)**
- Coverage: **V8** provider via Vitest

## File Organization

Tests live alongside source files in `__tests__/` subdirectories:

```
packages/semantic-core/
  src/
    indexer.ts
    __tests__/
      indexer.test.ts
      indexer.integration.test.ts
```

E2E tests in top-level `tests/e2e/`.

## Test Naming

```typescript
describe('SemanticIndexer', () => {
  describe('indexEntity', () => {
    it('generates embeddings for a contact entity', async () => { ... });
    it('deduplicates entities with cosine similarity > 0.85', async () => { ... });
    it('throws IndexerError when embedding service is unavailable', async () => { ... });
  });
});
```

## Coverage Requirements

| Scope | Minimum |
|-------|---------|
| `packages/**` | 80% |
| `apps/mcp-server/**` | 75% |
| `apps/api/**` | 70% |
| `apps/dashboard/**` | 50% |

## Integration Tests

Integration tests (`.integration.test.ts`) hit real services running in Docker:
- Postgres (pgvector)
- Redis
- Qdrant

Run with: `pnpm test:integration` (requires `docker-compose up -d` first)

## What to Test

**Unit tests:**
- All pure transformation functions
- Entity schema validation
- Token counting and budget enforcement
- Cache key generation logic
- Compression pipeline steps

**Integration tests:**
- Full connector sync cycle (mock API, real DB)
- Semantic cache read/write
- MCP tool invocations end-to-end
- Index + retrieve round trip

**E2E tests:**
- Dashboard connector setup flow
- MCP query from simulated Claude client
- Token savings are reported correctly

## Snapshot Testing

Use sparingly — only for MCP tool response schemas and connector entity shapes. Snapshots must be reviewed on change, not blindly updated.
