# Iris — Build Pipeline Changelog

Completed tasks are logged here by the daemon after each successful commit.

---

- 2026-06-07: feat(semantic-core,api,dashboard): index snapshot export & disaster recovery — IndexSnapshotService (gzip compressed snapshots, pruneOldSnapshots, create/list/restore), migration 040, REST routes /api/v1/snapshots, SnapshotManager dashboard component, 8 tests
- 2026-06-07: feat(semantic-core,api,dashboard): email template system & customization — EmailTemplateService (CRUD + render + variable interpolation), migration 041, REST routes /api/v1/email-templates, EmailTemplateEditor dashboard component with live preview, 21 tests
- 2026-06-07: feat(semantic-core,api,dashboard): distributed tracing & performance profiling — PerformanceProfiler (p50/p95/p99 per operation, Prometheus export, connector breakdown), migration 042, REST /api/v1/performance, ProfilerDashboard with window selector, 11 tests
- 2026-06-07: feat(core,api,dashboard): session management & device tracking — SessionManager (create/refresh/revoke sessions, trusted devices, geo-anomaly detection, 5-session limit), migration 038, REST /api/v1/sessions, SessionList dashboard component, 13 tests
- 2026-06-07: feat(semantic-core,api,dashboard): usage-based billing & metering — BillingMeter (recordUsage, calculateCharges, tier-based pricing, period close), migration 043, REST /api/v1/billing, BillingUsageChart + billing settings page, 11 tests

- 2026-06-07 feat(semantic-core,api,dashboard): proactive context surfacing — suggestion engine with time-of-day patterns, role affinities, co-occurrence analysis + REST API + dashboard widget

- 2026-06-07 feat(semantic-core,api,dashboard,mcp-server): PII field masking (redact/hash/tokenize) + workspace config API + dashboard panel + MCP tool integration + token consumption widget on dashboard overview

- 2026-06-05 | Snowflake Connector — SQL API sync, partition pagination, incremental sync, 17 MSW tests, 97.4% coverage

<!-- Entries appended below by the pipeline daemon -->
- 2026-06-06: COMMITTED Role-Based Context Segmentation — context_roles/role_entity_type_permissions tables (migration 012), ContextPermissionService, filterContextByRole, MCP tool enforcement, 125/125 tests + 43/43 mcp-server tests pass
- 2026-06-07: COMMITTED Knowledge Graph Visualization Dashboard — GET /api/v1/graph/query (BFS entity expansion + filters), SVG force-directed GraphVisualization component, EntityDetailPanel, GraphExplorer with type/relationship filters + search, /graph page; 100/100 API tests pass
- 2026-06-06: COMMITTED Query Decomposition & Entity Type Detection — keyword matching + gpt-4o-mini LLM fallback, in-process cache, retrieval engine integration, 27 unit tests pass
- 2026-06-06: COMMITTED Sync Scheduling & Frequency Configuration — migration 010, SyncScheduleService (BullMQ repeatable jobs), GET/PUT /connectors/:id/schedule endpoints, wizard frequency picker, 26/26 queue tests + 37/37 API tests pass (fixed mock bleed via mockReset on queue method fns)
- 2026-06-04: COMMITTED Package Manifests — package.json, tsconfig.json, turbo.json, pnpm workspace; root typecheck passes
- 2026-06-04: COMMITTED Local Infrastructure — docker-compose (postgres/pgvector, redis, qdrant), postgres-init.sql, db:migrate stub
- 2026-06-04: COMMITTED Logger — structured JSON logger, sensitive key scrubbing, child() factory, 10/10 tests pass
- 2026-06-04: COMMITTED Error Types — IrisError hierarchy, ConnectorError (retryable), neverthrow Result helpers, 9/9 tests pass
- 2026-06-04: COMMITTED Config Loader — zod env var validation, defaults, caching, _resetConfig for tests, 8/8 tests pass
- 2026-06-04: COMMITTED Connector Registry — ConnectorRegistry class with register/get/list/validateConfig, 12/12 tests pass
- 2026-06-04: COMMITTED Connector Test Utilities — createMockConnector() vi.fn stubs, assertEntityShape() shape validator
- 2026-06-04: COMMITTED HubSpot Connector — connect/sync/getSchema/healthCheck, MSW tests, 14/14 pass
- 2026-06-04: COMMITTED Notion Connector — page/database_row sync, property extraction, MSW tests, 13/13 pass
- 2026-06-04: COMMITTED Embedding Service — OpenAI text-embedding-3-small wrapper, batching, PII scrubbing, truncation, 10/10 tests
- 2026-06-04: COMMITTED Vector Store Interface — VectorStore interface + PgvectorStore (postgres + pgvector), integration tests
- 2026-06-04: COMMITTED Indexer Implementation — flushBatch with dedup (0.85 threshold), cosineSimilarity, 9/9 tests
- 2026-06-04: COMMITTED Retrieval Engine — queryContext with graph expansion, workspace isolation, 8/8 tests
- 2026-06-05: COMMITTED Semantic Cache — Redis-backed semantic cache (0.92 cosine threshold), set/get/invalidate, 12/12 tests pass
- 2026-06-05: COMMITTED Compression Pipeline — dedup/truncate/serialize stages, char-level budget enforcement, 19/19 tests pass
- 2026-06-05: COMMITTED MCP Server Bootstrap — 5 tools (query-context, list-entities, get-entity, get-metric, list-glossary), VectorStore extended, 15/15 tests pass
- 2026-06-05: COMMITTED Audit Logger — Postgres-backed MCP audit log, cursor pagination, error-resilient insert, 9/9 tests pass
- 2026-06-05: COMMITTED API Server Bootstrap — Hono app with connectors/entities/queries/audit routes, Clerk auth middleware, standard error envelope, 9/9 tests pass
- 2026-06-05: COMMITTED Prefix Cache Manager — buildPrefixContent (deterministic, sorted), PrefixCacheManager (get/set/invalidate), Redis-backed with 24h TTL, 13/13 tests pass
- 2026-06-05: COMMITTED Salesforce Connector — Contact/Account/Opportunity sync via SOQL, incremental cursor, pagination, MSW tests, 13/13 pass
- 2026-06-05: feat(tests): Playwright E2E test suites for connector lifecycle, query API, token analytics; fix ioredis import in mcp-server
- 2026-06-05: feat(graph): Neo4j GraphStore implementation with workspace isolation, unit tests, docker-compose Neo4j service
- 2026-06-06: feat(semantic-core): entity relationship indexing and graph-aware retrieval expansion
- 2026-06-06: feat(connector-airtable): Airtable connector with OAuth2, bases/tables/records sync, incremental filtering, MSW tests
- 2026-06-06: feat(connector-slack): Slack connector with channels/users/messages sync, relationship edges, incremental cursor
- 2026-06-06: feat(semantic-core): IndexStatusService with per-type entity counts, REST endpoint, dashboard component
feat(api): webhook-driven real-time sync (HubSpot + Slack HMAC validation, 10 tests)
- 2026-06-06: feat(semantic-core,mcp-server): Role-Based Context Segmentation — context_roles table, ContextPermissionService, filterContextByRole pure function, MCP tools (query-context/list-entities/get-entity) integrated; 125/125 semantic-core tests pass
2026-06-07 feat(queue,api,dashboard): sync job error recovery & dead letter queue — deadletter_jobs migration, DlqService with archive/list/retry, admin routes GET /admin/dlq + POST /admin/dlq/:id/retry, DlqInspector component, /admin/dlq dashboard page
- feat(semantic-core,api,dashboard): workspace data export & backup service — DataExporter, export jobs table, REST routes, admin import, BackupManager UI, 33 tests
- feat(connector-sdk,api): custom connector framework & user-extensible SDK — loadUserConnector, validateConnectorDefinition, REST CRUD, migration 023, 26 tests
- feat(api,semantic-core,dashboard): cross-connector entity linking & data enrichment (667a392)
- feat(mcp-server,semantic-core): advanced MCP query features & aggregations (f921772)
- feat(connector-sdk,dashboard): comprehensive webhook validation & testing suite (75973e2)
- feat(api,dashboard,queue): real-time sync performance monitoring dashboard (9651820)
