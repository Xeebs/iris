# Iris — Build Pipeline Queue

Tasks are listed in execution order, layer by layer. The pipeline works top-to-bottom, selecting the first UNWORKED Critical task, then High, then Medium.

> **SLICE MODE COMPLETE** — `docs/VERTICAL_SLICE.md` was flipped to `ACHIEVED 2026-06-10`. Pipeline has returned to breadth work. All layers are now open; select by priority (Critical → High → Medium).

**Statuses**: `UNWORKED` → `IN_PROGRESS` → `TESTING` → `COMMITTED` | `DEPRIORITIZED`

Completed tasks are moved to `pipeline/queue-archive.md` by `scripts/archive-queue.py` — run it after marking a task COMMITTED so the live queue stays small (every session reads this file).

---

## Layer CI: GitHub CI Green Gate (Always-On)

### Task: ci-green-gate
- **Layer**: CI — GitHub CI Green Gate
- **Status**: UNWORKED
- **Priority**: Critical
- **Description**: Verify all GitHub CI pipelines are passing before any feature work proceeds. Run `gh run list --limit 10` and inspect every failing run with `gh run view <id> --log-failed`. For each failure: identify the root cause (migration conflict, type error, test failure, missing dependency, etc.), fix it, commit, push, then confirm the subsequent CI run is green. Repeat until `gh run list --limit 5` shows all recent runs as `success`. This task is never permanently COMMITTED — it resets to UNWORKED at the start of every pipeline cycle. The pipeline must re-check CI before each new feature task.
- **Files**: any broken migration, source, or config file identified by CI logs
- **Depends on**: nothing
- **Added**: 2026-06-09

---

## Layer 78: VERTICAL SLICE — The Only Feature Work Allowed (see docs/VERTICAL_SLICE.md)

> While `docs/VERTICAL_SLICE.md` reads `NOT ACHIEVED`, the pipeline selects ONLY from this layer (plus the CI gate). All other layers are frozen. Goal: one command proving connect → sync → index → serve → query → measure, from a clean DB, with a ≥70% token-savings report.

### Task: VS-2c Start the sync worker in the API process (slice blocker B1)
- **Layer**: 78 — Vertical Slice
- **Status**: RESOLVED_BY_VS-3 (commit 2731534) — `apps/api/src/workers/sync-worker.ts` now has a standalone bootstrap gated by `SYNC_WORKER_STANDALONE=true`, and `scripts/slice-demo.ts` spawns it as a separate worker process (env sets `SYNC_WORKER_STANDALONE=true`); `registerConnectors()` is also called in `server.ts:105`. The sync→index chain is wired. No separate change needed; do not pick up.
- **Priority**: Critical
- **Description**: Slice path audit (VS-1) found that `apps/api/src/workers/sync-worker.ts` (`createSyncWorker`) is never started in the API bootstrap — `server.ts main()` only starts the HTTP server, so enqueued `POST /api/v1/connectors/:id/sync` jobs are never consumed and entities never reach the indexer through the real REST path. Fix: in the API bootstrap, call `registerConnectors()` and start `createSyncWorker(sql, vectorStore, openAiKey, redisUrl)` so the BullMQ worker runs alongside the server (gate behind an env flag like `RUN_SYNC_WORKER=true` if a separate worker process is preferred — but the slice demo runs a single API process, so default it on when `DEMO_MODE=true`). Ensure clean shutdown on SIGTERM. Coordinate with VS-3 (which also edits `server.ts`/bootstrap) to avoid a collision. Verify with `scripts/slice-demo.sh`: after triggering sync, indexed entity count in the vector store must match fixture counts. This is the single ❌ blocker in the path audit table in docs/VERTICAL_SLICE.md.
- **Files**:
  - apps/api/src/server.ts (start worker + registerConnectors in main())
  - apps/api/src/workers/sync-worker.ts (if a startup helper/flag is needed)
- **Depends on**: VS-2 Demo-mode HubSpot sync against fixtures
- **Added**: 2026-06-09

## Layer 77: API Surface Wiring (Critical Product Gap)

### Task: Mount orphaned API route modules in server.ts
- **Layer**: 77 — API Surface Wiring
- **Status**: IN_PROGRESS — Batch 2 committed (2026-06-10): api-keys, search, usage, mcp-tools, query-analytics, connector-health, documents mounted; data-quality-engine test failures fixed (3 missing routes added). 75 routes still unmounted. Next batch: sync-metrics, dedup-admin, documents, context-search, entity-change-stream, enrichment-config/quality.
- **Priority**: High
- **Description**: ~80 route factories in `apps/api/src/routes/*.ts` are exported and have passing unit tests but are NEVER mounted in `apps/api/src/server.ts`, so their endpoints return 404 in the running server. The pipeline generates a route module + test but does not wire it into `createApp`. This means many "implemented" features (including core flows like `/api/v1/api-keys` MCP key management, which the e2e fixtures depend on) are unreachable. Fix incrementally: (1) enumerate unmounted factories — for each `export function (create*Routes|make*Router)` in routes/, check it is referenced in server.ts; (2) for each, determine its constructor dependencies (sql / sql+redis / sql+vectorStore / sql+masterSecret) and the prefix asserted by its own test file (`app.route('<prefix>', ...)`); (3) mount in `createApp` under that prefix on the `authed` router (or `app` for unauthenticated webhooks), resolving any prefix collisions and sourcing required secrets from env; (4) build (`pnpm --filter @iris/api build`), commit a small BATCH (5–10 routes), push, and watch the Load Testing *Integration* job (boots the server, hits /health) to confirm boot. NEVER mount all at once — a single bad constructor (I/O at construction) or route collision breaks server boot and turns CI red. First batch already done (commit 342ce53): entity-search, granular-permissions, permission-management. Highest-value next: api-keys (needs a master secret — confirm the MCP auth-verify path uses the same key store first), search, usage, workflows, mcp-tools, query-analytics. Each batch must keep CI green before the next.
- **Files**:
  - apps/api/src/server.ts (route mounts)
  - any route factory whose signature/types need a small fix to mount
- **Depends on**: nothing
- **Added**: 2026-06-09

---

## Layer 74: Post-MVP Scale - Developer Experience & Advanced Analytics

### Task: Sync Events Listener & Event-Driven Connector Updates
- **Layer**: 74 — Post-MVP Scale - Developer Experience & Advanced Analytics
- **Status**: UNWORKED
- **Priority**: Medium
- **Description**: Complete the sync-events.ts module (currently 22 lines) by building a full event-driven sync coordinator. Currently the system polls on a schedule; this task adds real-time event handling for connector changes from webhooks (HubSpot, Slack, Stripe, etc.) and Postgres LISTEN/NOTIFY. Create packages/semantic-core/src/__tests__/sync-events.test.ts (14+ tests): (1) registerSyncEventListener(connectorId, eventType) subscribing to 'contact.updated', 'deal.created', 'user.removed' events, (2) emitSyncEvent(event) broadcasting to Redis pub/sub with event deduplication (within 5sec window), (3) debounceSyncEvents(events, windowMs=5000) coalescing 20 contact updates into single sync batch, (4) prioritizeSyncEvents() high-priority-first (user.removed > contact.updated > deal.updated), (5) trackEventMetrics(connectorId) recording events/sec, dedup ratio, batch sizes. Create packages/semantic-core/src/sync-event-coordinator.ts with SyncEventCoordinator: (1) subscribeToPgNotifications(pgClient, connectorId) using Postgres LISTEN for table changes, (2) registerWebhookHandler(connectorId, webhookUrl) for providers with native webhooks, (3) startEventLoop() continuously consuming Redis events, batching, and triggering sync jobs via BullMQ, (4) getEventMetrics(connectorId) returning events/hour, avg batch size, latency. Create apps/api/migrations/172_sync_events.sql with: sync_events (event_id, connector_id, event_type, entity_type, entity_id, timestamp, processed: bool), event_batches (batch_id, connector_id, events_json, batch_size, sync_job_id, created_at). Add 10+ integration tests with mock Redis and Postgres LISTEN. Integrate into server.ts to auto-start event loop on startup.
- **Files**:
  - packages/semantic-core/src/__tests__/sync-events.test.ts
  - packages/semantic-core/src/__tests__/sync-events.integration.test.ts
  - packages/semantic-core/src/sync-event-coordinator.ts
  - packages/semantic-core/src/__tests__/sync-event-coordinator.test.ts
  - apps/api/migrations/172_sync_events.sql
  - apps/api/src/routes/sync-events-admin.ts
  - apps/api/src/__tests__/sync-events-admin.test.ts
- **Depends on**: nothing
- **Added**: 2026-06-09

### Task: Intelligent Query Recommendation Engine with User Behavior Learning
- **Layer**: 74 — Post-MVP Scale - Developer Experience & Advanced Analytics
- **Status**: UNWORKED
- **Priority**: Medium
- **Description**: Build a machine learning system that learns from user query history, MCP tool usage patterns, and context access logs to recommend relevant queries and context before users ask. This system complements the proactive-suggester by adding ML-based behavior clustering and anomaly detection. Create packages/semantic-core/src/query-recommender.ts with QueryRecommender: (1) analyzeUserQueryPatterns(userId, days=30) extracting: query intent distribution (operational % vs analytical %), most-used entity types, common filter combinations, time-of-day patterns, query length distribution, (2) clusterSimilarQueries(queries) using embedding-based clustering (cosine similarity >0.80) to find query families, (3) predictNextQuery(userId, currentQuery) based on n-gram model (if user asked Q1, they usually ask Q2 next), returning top-3 predictions with confidence, (4) detectAnomalousQuery(query, userProfile) flagging unusual queries (e.g., user suddenly querying sensitive data they never accessed), (5) scoreQueryRelevance(query, user, context) combining: user affinity (0-1 based on query pattern match), timeliness (higher if time-of-day matches typical pattern), business importance (derived from entity type+filter criticality), (6) rankRecommendations(queries, user) sorting by relevance score with diversity constraint (avoid duplicate entity types in top-5). Create migration 173 (user_query_patterns, query_clusters, query_recommendations, query_anomalies). Expose REST: GET /api/v1/users/:userId/query-recommendations (top-5 predicted queries with UI preview), POST /api/v1/users/:userId/query-feedback (mark recommendation relevant/irrelevant), GET /api/v1/users/:userId/behavior-profile (return extracted patterns). Build dashboard component apps/dashboard/components/query-recommendation-panel.tsx showing: top-3 predicted queries as pill buttons, "Why recommended?" explanation (shows pattern match reason), "Learn more" drill-down to behavior profile. Add 16+ tests: clustering accuracy, prediction evaluation (precision@3), anomaly scoring consistency.
- **Files**:
  - packages/semantic-core/src/query-recommender.ts
  - packages/semantic-core/src/__tests__/query-recommender.test.ts
  - packages/semantic-core/src/__tests__/query-recommender.integration.test.ts
  - apps/api/src/routes/query-recommendations.ts
  - apps/api/src/__tests__/query-recommendations.test.ts
  - apps/api/migrations/173_query_recommendations.sql
  - apps/dashboard/components/query-recommendation-panel.tsx
- **Depends on**: nothing
- **Added**: 2026-06-09

---

## Layer 76: Dashboard Test Coverage & WebSocket Infrastructure

### Task: Configuration Validation & Database Migration Tests
- **Layer**: 76 — Dashboard Test Coverage & WebSocket Infrastructure
- **Status**: UNWORKED
- **Priority**: Medium
- **Description**: Create test infrastructure for database migrations and configuration validation to catch breaking changes and data loss risks. Build packages/semantic-core/src/__tests__/config-validator.test.ts with 14+ tests covering: (1) validateWorkspaceConfig(config) schema validation for workspace settings (context budget, sync frequency, default entity types), (2) detectConfigBreakingChanges(oldConfig, newConfig) identifying incompatible migrations (enum value removals, required field additions), (3) validateConnectorConfig(connectorId, config) per-connector config validation (OAuth required fields, API URL formats, API key patterns), (4) migrateLegacyConfig(oldFormat) forward-compatibility for older workspace configs, (5) encryptSensitiveFields(config) ensuring API keys and OAuth tokens encrypted before storage. Create apps/api/src/__tests__/migrations.test.ts with 12+ migration tests covering: (1) forward migration runs without errors, (2) backward rollback succeeds (if applicable), (3) idempotency (running same migration twice is safe), (4) data integrity (no data loss during schema changes), (5) constraint enforcement (foreign keys, unique indexes created), (6) trigger/view creation verified. Test 3-4 critical migrations: 168_granular_permissions.sql (field_permissions table), 170_workflow_sessions.sql (workflow execution tracking), 171_stream_metrics.sql (streaming session logging). Use Postgres database in Docker for integration tests. Reference code-style.md for Result pattern on validation functions.
- **Files**:
  - packages/semantic-core/src/config-validator.ts
  - packages/semantic-core/src/__tests__/config-validator.test.ts
  - apps/api/src/__tests__/migrations.test.ts
  - apps/api/src/__tests__/migration-rollback.test.ts
- **Depends on**: nothing
- **Added**: 2026-06-09

### Task: Critical End-to-End Workflow Tests
- **Layer**: 76 — Dashboard Test Coverage & WebSocket Infrastructure
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Create end-to-end Playwright tests for 4 critical user workflows to verify multi-layer integration works: (1) Connector setup → sync → entity search workflow (user creates HubSpot connector with OAuth, waits for initial sync, searches for entities), (2) Query execution with MCP context workflow (user submits natural language query → system decomposes → queries connectors → returns context via MCP stream), (3) Admin data quality remediation workflow (admin scans connector data → reviews issues → marks as resolved → monitors improvement), (4) Field-level permission enforcement workflow (admin defines field permission rules → user attempts access → verifies masking applied correctly). Each test should cover happy path + 1-2 error scenarios. Use test fixtures for: pre-configured test workspaces, seed data (100 test contacts in HubSpot), auth tokens for test admin user. Tests must verify: API responses, dashboard UI state changes, database audit trails, WebSocket message delivery (where applicable). Run tests in --headed mode on CI for debugging. Reference testing.md for E2E patterns. Expect 600-800ms per test (use timeouts carefully).
- **Files**:
  - tests/e2e/connector-sync-search-workflow.spec.ts
  - tests/e2e/query-context-mcp-workflow.spec.ts
  - tests/e2e/data-quality-remediation-workflow.spec.ts
  - tests/e2e/field-permission-enforcement-workflow.spec.ts
- **Depends on**: Granular Access Control with Field-Level & Connector-Level Permissions
- **Added**: 2026-06-09
