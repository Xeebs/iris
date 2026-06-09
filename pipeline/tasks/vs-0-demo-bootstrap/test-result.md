# VS-0 Bootstrap workspace + API key — test result

- `pnpm --filter @iris/api typecheck` — PASS
- `vitest run src/__tests__/demo-bootstrap.test.ts` — PASS (7/7)

Notes: key creation goes through `ApiKeyManager.createKey()` (SHA-256 key_hash),
the same path `apps/mcp-server/src/auth.ts` validates against, so the bootstrap
key works directly for MCP auth. Route is 404 unless DEMO_MODE=true and is only
mounted pre-Clerk when DEMO_MODE=true.
