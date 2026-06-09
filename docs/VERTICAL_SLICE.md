# The Vertical Slice — Iris's Only Milestone Right Now

**Status: NOT ACHIEVED** (update this line to `ACHIEVED <date>` only when every acceptance criterion below has been demonstrated, twice, from a clean database.)

## Why this document exists

After 344 pipeline cycles, Iris has ~1,350 TypeScript files, 14 connectors, and 285 completed tasks — and has never once demonstrated its core value proposition end to end. Features were built and tested in isolation (~80 API route modules were never even mounted). This document redirects all pipeline effort to a single goal:

> **One user connects HubSpot, asks a business question through Iris via MCP, and gets a correct answer that costs measurably fewer tokens than pasting the raw data.**

Until that demo works, reliably, from scratch, **no new features may be built**. Every pipeline cycle must either advance this slice or fix something that blocks it.

## The slice, precisely

One unbroken chain, every link running as a real process against real local infrastructure (Postgres/pgvector, Redis, Qdrant via `infra/docker/docker-compose.yml`):

```
1. CONNECT   A workspace + HubSpot connector instance is created via the REST API
             (connector runs in fixture/sandbox mode — no real HubSpot account needed,
              fixtures: packages/connectors/hubspot/tests/fixtures/)
2. SYNC      The connector sync runs and yields SemanticEntities (contacts, companies, deals)
3. INDEX     The indexer embeds and stores those entities in the vector store
4. SERVE     The MCP server starts, authenticates with a workspace-scoped API key
5. QUERY     A scripted MCP client calls `query-context` with canonical business questions
6. ANSWER    The responses contain the correct facts from the fixture data,
             within the contextBudget
7. MEASURE   Token usage of the Iris response is logged and compared to the
             raw-fixture-paste baseline; the savings ratio is reported
```

## Acceptance criteria

All of these, verified by `scripts/slice-demo.sh` (single command, exit 0 = pass):

- [ ] `scripts/slice-demo.sh` runs the full chain above from a **fresh database** (drops/recreates, runs migrations) with no manual steps
- [ ] All 5 canonical questions (below) return answers containing the expected facts
- [ ] Every response respects `contextBudget` (default 2000 tokens)
- [ ] The demo prints a token report: Iris response tokens vs. raw fixture JSON tokens, per question — savings must be ≥ 70%
- [ ] The demo passes **twice in a row** from clean state (proves no hidden state/ordering luck)
- [ ] The demo runs in CI as a required job (`slice-demo`) and is green
- [ ] A human (the project owner) has run it locally and seen it work

## Canonical questions (fixture-grounded)

These are asserted against known values in the HubSpot fixtures. If fixtures change, update both together.

1. "How many open deals do we have, and what is their total value?"
2. "Which company does <fixture contact name> work for?"
3. "List our deals in the negotiation stage."
4. "Who is the owner of our largest deal?"
5. "Which contacts belong to <fixture company name>?"

## What is explicitly OUT of scope until the slice is achieved

- New connectors, new MCP tools, new dashboard pages, new REST routes (beyond those the slice requires)
- Enterprise features of any kind: SLO/HA/tracing/governance/compliance/analytics/recommendations
- Mounting the remaining orphaned routes (only slice-critical routes get mounted now; the rest resume post-slice)
- Test-coverage padding on code the slice doesn't touch

## Path audit

Traced 2026-06-09 (task VS-1). Each link of the connect → sync → index → serve → query chain verified against the running code. Legend: ✅ works · ⚠️ works with caveat · ❌ broken (blocks slice).

| # | Link | Code location | Exists | Wired / Mounted | Status |
|---|------|---------------|--------|-----------------|--------|
| 1a | `POST /api/v1/demo/bootstrap` (workspace + MCP API key) | `apps/api/src/routes/demo-bootstrap.ts`, mounted `server.ts:148` **before** Clerk, `DEMO_MODE=true` only | yes | yes | ✅ Uses `ApiKeyManager.createKey()` → `mcp_api_keys`. Returns `{ workspaceId, apiKey }`. |
| 1b | `POST /api/v1/connectors` (create HubSpot instance) | `apps/api/src/routes/connectors.ts`, mounted `server.ts:174` on `authed` | yes | yes | ✅ Reachable with the demo API key via `demoApiKeyAuth`. |
| 2a | `POST /api/v1/connectors/:id/sync` (trigger sync) | `connectors.ts:196` | yes | yes | ⚠️ Only enqueues to `SyncJobQueue` (BullMQ/Redis) when `redisUrl` is set; otherwise silently no-ops. |
| 2b | **Sync worker consumes the queue** | `apps/api/src/workers/sync-worker.ts` (`createSyncWorker`) | yes | **NO** | ❌ **BLOCKER.** `server.ts main()` starts the HTTP server only — it never calls `createSyncWorker(...)` nor `registerConnectors()`. Enqueued jobs are never processed, so sync never reaches the indexer in the running API process. |
| 2c | HubSpot demo-mode sync against fixtures | `packages/connectors/hubspot` (`demoMode` flag, VS-2) | yes | n/a | ✅ Committed (VS-2). Routes the HTTP layer to fixtures; same `sync()` path. |
| 3a | `indexEntities` embeds + stores entities | `packages/semantic-core/src/indexer.ts:103`, called from `sync-worker.ts:10` | yes | via worker | ⚠️ Correct, but only runs if link 2b runs. |
| 3b | Embedding provider (no external key in demo) | `embedding-provider.ts` `createEmbeddingProvider()` reads `EMBEDDING_PROVIDER`; `hash-deterministic` → `DeterministicHashProvider` (VS-1b) | yes | yes | ✅ Committed (VS-1b). |
| 3c | Vector store | `PgvectorStore(DATABASE_URL)` in both `server.ts:297` and `mcp-server/src/server.ts:227` | yes | yes | ✅ pgvector (not Qdrant) on both sides, same `DATABASE_URL` → same store. |
| 4 | MCP server authenticates with the workspace API key | `apps/mcp-server/src/server.ts:195` `validateMcpApiKey()` → `ApiKeyManager.validateKey()` (`auth.ts:41`) | yes | yes | ✅ Same `ApiKeyManager`/`mcp_api_keys` store the bootstrap wrote to. Key read from `IRIS_API_KEY` env. |
| 5 | `query-context` retrieves indexed entities | `apps/mcp-server/src/tools/query-context.ts` → `retrieveContext(vectorStore)` + `compress` + `contextBudget` | yes | yes | ✅ Registered in `server.ts:70`; respects `contextBudget`. |

### Blockers found (slice-critical)

- **B1 (link 2b):** The BullMQ sync worker is never started in the API process. New task **VS-2c** added below. Until fixed, `scripts/slice-demo.sh` cannot get from "sync triggered" to "entities indexed" through the real REST path. *Not fixed here* because the API bootstrap (`server.ts`) is being edited concurrently by a parallel worker (VS-3); folding the worker startup into the demo path is cleaner and is captured as VS-2c.

### Non-blocking notes (not slice-critical — do NOT fix in slice mode)

- `/api/v1/api-keys` (`routes/api-key-management.ts`) is **not mounted**, but the slice does not need it — the demo bootstrap issues the key directly. Resume under the Layer 77 mounting sweep post-slice.
- `POST /:id/sync` requires Redis to do anything (link 2a). The demo must run with `REDIS_URL` set (already required by `docker-compose`); acceptable for the slice.

No slice-critical route was found unmounted, so `server.ts` is **not** modified by VS-1 (avoids colliding with the in-flight parallel edit). The one blocker is process wiring, tracked as VS-2c.

## After the slice

When the status line at the top reads ACHIEVED, the pipeline returns to `pipeline/queue.md` breadth work — starting with the deprioritized route-mounting sweep — but every future feature task must state how it serves a user-visible flow.
