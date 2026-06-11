# Iris — Build Pipeline Queue

Tasks are listed in execution order, layer by layer. The pipeline works top-to-bottom, selecting the first UNWORKED Critical task, then High, then Medium.

> **SLICE 2 MODE** — `docs/SLICE_2.md` reads `NOT ACHIEVED`. Task selection is restricted to the CI gate, **Layer 79 — Slice 2**, and finishing the in-flight Layer 77 mounting task. Layers 74/76 are FROZEN — do not select from them regardless of priority. See the CURRENT FOCUS section of CLAUDE.md.

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

## Layer 77: API Surface Wiring (Critical Product Gap)

> Mid-flight from before the Slice 2 pivot. May be finished (it repairs an existing product gap), but never takes priority over an UNWORKED Layer 79 task.

### Task: Mount orphaned API route modules in server.ts
- **Layer**: 77 — API Surface Wiring
- **Status**: IN_PROGRESS — Batches 2–9 committed (2026-06-10): 34 routes now mounted in total (api-keys, search, usage, mcp-tools, query-analytics, connector-health, documents, sync-metrics, context-search, enrichments, validation, bulk-ops, analytics-pipeline, insights, dedup-admin, entity-change-stream, enrichment-quality, freshness-tracking, governance-dashboard, admin-cost-audit, workspace-costs, computed-metrics, api-version-admin, business-rules, cache-optimization, cache-prewarming, connector-performance, data-quality, quota-management, slo-admin, backup-recovery, budget-management, circuit-breaker-admin, compliance-audit, connector-benchmarks, cost-attribution, data-lineage, entity-reconciliation, batch-recommendations, health-scorecards, dsr, entity-subscriptions, entity-lifecycle, sync-optimizer, agent-feedback, context-deltas, context-summarization, context-versioning, field-mappings, event-streams, graphql, ha-admin, health-forecasts, index-repair, llm-providers, mcp-resource-discovery, mcp-streaming, mcp-subscriptions). 34 routes still unmounted. Next: mcp-tool-discovery, metrics-anomalies, multi-connector-optimizer, nl-query-generator, nl-query-sessions, osi-interchange, pii-masking-audit, query-cost-analysis, query-execution-plans, plus SqlBindings refactors for federation, llm-cost-optimization, mcp-auto-tools, query-clustering, relationship-inference.
- **Priority**: High
- **Description**: ~80 route factories in `apps/api/src/routes/*.ts` are exported and have passing unit tests but are NEVER mounted in `apps/api/src/server.ts`, so their endpoints return 404 in the running server. The pipeline generates a route module + test but does not wire it into `createApp`. This means many "implemented" features (including core flows like `/api/v1/api-keys` MCP key management, which the e2e fixtures depend on) are unreachable. Fix incrementally: (1) enumerate unmounted factories — for each `export function (create*Routes|make*Router)` in routes/, check it is referenced in server.ts; (2) for each, determine its constructor dependencies (sql / sql+redis / sql+vectorStore / sql+masterSecret) and the prefix asserted by its own test file (`app.route('<prefix>', ...)`); (3) mount in `createApp` under that prefix on the `authed` router (or `app` for unauthenticated webhooks), resolving any prefix collisions and sourcing required secrets from env; (4) build (`pnpm --filter @iris/api build`), commit a small BATCH (5–10 routes), push, and watch the Load Testing *Integration* job (boots the server, hits /health) to confirm boot. NEVER mount all at once — a single bad constructor (I/O at construction) or route collision breaks server boot and turns CI red. Each batch must keep CI green before the next.
- **Files**:
  - apps/api/src/server.ts (route mounts)
  - any route factory whose signature/types need a small fix to mount
- **Depends on**: nothing
- **Added**: 2026-06-09

---

## Layer 74: Post-MVP Scale - Developer Experience & Advanced Analytics — ❄ FROZEN (Slice 2 mode)

> Frozen 2026-06-10 by the Slice 2 pivot. Do not select tasks from this layer while `docs/SLICE_2.md` reads `NOT ACHIEVED`. After Slice 2, these re-enter the queue only if they serve a user-visible flow (post-slice prune comes first — see docs/SLICE_2.md "After the slice").

### Task: Sync Events Listener & Event-Driven Connector Updates
- **Layer**: 74 — Post-MVP Scale - Developer Experience & Advanced Analytics
- **Status**: FROZEN
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
- **Status**: FROZEN
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

## Layer 76: Dashboard Test Coverage & WebSocket Infrastructure — ❄ FROZEN (Slice 2 mode)

> Frozen 2026-06-10 by the Slice 2 pivot. Do not select tasks from this layer while `docs/SLICE_2.md` reads `NOT ACHIEVED`. Note: S2-5 supersedes the connector-setup portions of the e2e task below.

### Task: Configuration Validation & Database Migration Tests
- **Layer**: 76 — Dashboard Test Coverage & WebSocket Infrastructure
- **Status**: FROZEN
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
- **Status**: FROZEN
- **Priority**: High
- **Description**: Create end-to-end Playwright tests for 4 critical user workflows to verify multi-layer integration works: (1) Connector setup → sync → entity search workflow (user creates HubSpot connector with OAuth, waits for initial sync, searches for entities), (2) Query execution with MCP context workflow (user submits natural language query → system decomposes → queries connectors → returns context via MCP stream), (3) Admin data quality remediation workflow (admin scans connector data → reviews issues → marks as resolved → monitors improvement), (4) Field-level permission enforcement workflow (admin defines field permission rules → user attempts access → verifies masking applied correctly). Each test should cover happy path + 1-2 error scenarios. Use test fixtures for: pre-configured test workspaces, seed data (100 test contacts in HubSpot), auth tokens for test admin user. Tests must verify: API responses, dashboard UI state changes, database audit trails, WebSocket message delivery (where applicable). Run tests in --headed mode on CI for debugging. Reference testing.md for E2E patterns. Expect 600-800ms per test (use timeouts carefully).
- **Files**:
  - tests/e2e/connector-sync-search-workflow.spec.ts
  - tests/e2e/query-context-mcp-workflow.spec.ts
  - tests/e2e/data-quality-remediation-workflow.spec.ts
  - tests/e2e/field-permission-enforcement-workflow.spec.ts
- **Depends on**: Granular Access Control with Field-Level & Connector-Level Permissions
- **Added**: 2026-06-09

---
