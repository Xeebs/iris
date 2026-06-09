# VS-3 One-command slice demo script — test result

- `pnpm --filter @iris/semantic-core typecheck` — PASS
- `pnpm --filter @iris/api typecheck` — PASS
- api tests (demo-bootstrap, middleware, connectors): 150/150 PASS
- semantic-core indexer + vector-store tests: 21/21 PASS
- Hash-embedding dedup safety check: max pairwise fixture cosine = 0.632 (< 0.85 threshold)

Slice-path fixes bundled (each was a broken link found while wiring):
1. iris_entities.workspace_id was derived from the entity id prefix ("hubspot"),
   so workspace-scoped queries matched nothing — upsert now takes workspaceId,
   threaded from sync-job → indexEntities → vector store.
2. Connector registry was empty process-wide — new apps/api/src/connector-registration.ts,
   called by createApp() and createSyncWorker(); @iris/connector-hubspot added as api dep.
3. server.ts never passed a SyncJobQueue to connector routes — POST /:id/sync was a no-op.
4. REST auth was Clerk-only — demoApiKeyAuth (DEMO_MODE only) accepts the bootstrap
   MCP API key and injects workspaceId; requireAuth passes through demo-authenticated requests.

NOT VERIFIED LIVE: this machine has no Docker/Postgres/Redis, so scripts/slice-demo.sh
could not be executed end-to-end locally. First live execution happens in CI when VS-6
adds the slice-demo job (with pg/redis service containers) or on the owner's machine.
