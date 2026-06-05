# Iris — Build Pipeline Changelog

Completed tasks are logged here by the daemon after each successful commit.

---

<!-- Entries appended below by the pipeline daemon -->
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
