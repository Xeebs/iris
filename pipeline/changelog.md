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
