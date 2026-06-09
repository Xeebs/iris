# Iris — Build Pipeline Queue

Tasks are listed in execution order, layer by layer. The pipeline works top-to-bottom, selecting the first UNWORKED High task, then Medium.

**Statuses**: `UNWORKED` → `IN_PROGRESS` → `TESTING` → `COMMITTED` | `DEPRIORITIZED`

---

## Layer 0: Foundation

### Task: Package Manifests
- **Layer**: 0 — Foundation
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create package.json files for all packages and apps with correct names, dependencies, and build scripts. Also create turbo.json pipeline config. Packages: @iris/core, @iris/connector-sdk, @iris/connectors, @iris/semantic-core, @iris/cache, @iris/compression, @iris/graph. Apps: @iris/mcp-server, @iris/api, @iris/dashboard.
- **Files**:
  - turbo.json
  - packages/core/package.json
  - packages/connector-sdk/package.json
  - packages/semantic-core/package.json
  - packages/cache/package.json
  - packages/compression/package.json
  - packages/graph/package.json
  - apps/mcp-server/package.json
  - apps/api/package.json
  - apps/dashboard/package.json
- **Depends on**: nothing
- **Added**: 2026-06-04

### Task: Local Infrastructure
- **Layer**: 0 — Foundation
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create docker-compose.yml for local dev services: Postgres 16 with pgvector extension, Redis 7, Qdrant latest. Include init SQL to enable pgvector and create the iris database. Add a db:migrate script stub.
- **Files**:
  - infra/docker/docker-compose.yml
  - infra/docker/postgres-init.sql
- **Depends on**: nothing
- **Added**: 2026-06-04

---

## Layer 1: Core Package

### Task: Logger
- **Layer**: 1 — Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/core/src/logger.ts using pino. Export a typed logger with info/warn/error/debug methods. Support structured metadata as second argument. Export a child logger factory for connector-scoped logging.
- **Files**:
  - packages/core/src/logger.ts
  - packages/core/src/__tests__/logger.test.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

### Task: Error Types
- **Layer**: 1 — Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/core/src/errors.ts. Define IrisError base class, ConnectorError (retryable flag), IndexerError, CacheError, MCPError. Use neverthrow for Result<T,E> wrappers. Export err() and ok() helpers.
- **Files**:
  - packages/core/src/errors.ts
  - packages/core/src/__tests__/errors.test.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

### Task: Config Loader
- **Layer**: 1 — Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/core/src/config.ts. Use zod to validate env vars at startup. Export typed config object with all env vars from .env.example. Throw a clear error on missing required vars so startup fails fast.
- **Files**:
  - packages/core/src/config.ts
  - packages/core/src/__tests__/config.test.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

---

## Layer 2: Connector SDK

### Task: Connector Registry
- **Layer**: 2 — Connector SDK
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/connector-sdk/src/registry.ts. A class that holds registered ConnectorManifests, can look up by id, list all registered connectors, and validate a config against the connector's configSchema. Include unit tests with 2+ connectors.
- **Files**:
  - packages/connector-sdk/src/registry.ts
  - packages/connector-sdk/src/__tests__/registry.test.ts
- **Depends on**: Error Types
- **Added**: 2026-06-04

### Task: Connector Test Utilities
- **Layer**: 2 — Connector SDK
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement packages/connector-sdk/src/test-utils.ts. Export createMockConnector() factory that returns a BaseConnector with all methods as vi.fn(). Export a helper assertEntityShape(entity) that validates a SemanticEntity has all required fields in the right format.
- **Files**:
  - packages/connector-sdk/src/test-utils.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

---

## Layer 3: First Connectors

### Task: HubSpot Connector
- **Layer**: 3 — Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Full HubSpot CRM connector in packages/connectors/hubspot/. Implement connect() with OAuth2 token exchange, sync() as an AsyncGenerator yielding contacts, companies, and deals as SemanticEntity objects (cursor-based pagination), getSchema(), healthCheck(). Include ConnectorManifest. Use MSW to mock HubSpot API in tests.
- **Files**:
  - packages/connectors/hubspot/src/hubspot-connector.ts
  - packages/connectors/hubspot/src/manifest.ts
  - packages/connectors/hubspot/src/transformers.ts
  - packages/connectors/hubspot/src/__tests__/hubspot-connector.test.ts
  - packages/connectors/hubspot/tests/fixtures/contacts.json
  - packages/connectors/hubspot/tests/fixtures/companies.json
  - packages/connectors/hubspot/tests/fixtures/deals.json
  - packages/connectors/hubspot/package.json
- **Depends on**: Connector Registry, Logger, Error Types
- **Added**: 2026-06-04

### Task: Notion Connector
- **Layer**: 3 — Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Full Notion connector in packages/connectors/notion/. Implement connect() with OAuth2, sync() yielding database rows and pages as SemanticEntity objects, getSchema() from Notion database schemas, healthCheck(). Use MSW for tests.
- **Files**:
  - packages/connectors/notion/src/notion-connector.ts
  - packages/connectors/notion/src/manifest.ts
  - packages/connectors/notion/src/transformers.ts
  - packages/connectors/notion/src/__tests__/notion-connector.test.ts
  - packages/connectors/notion/tests/fixtures/databases.json
  - packages/connectors/notion/tests/fixtures/pages.json
  - packages/connectors/notion/package.json
- **Depends on**: Connector Registry, Logger, Error Types
- **Added**: 2026-06-04

---

## Layer 4: Semantic Core

### Task: Embedding Service
- **Layer**: 4 — Semantic Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/embedding.ts. Wrap OpenAI text-embedding-3-small. Accept a batch of SemanticEntity objects, build the embedding input string per embedding-patterns.md rules (type:label; attrs), call the API in batches of 100, return float32 vectors. Log latency and token counts. Skip PII fields.
- **Files**:
  - packages/semantic-core/src/embedding.ts
  - packages/semantic-core/src/__tests__/embedding.test.ts
- **Depends on**: Package Manifests, Logger
- **Added**: 2026-06-04

### Task: Vector Store Interface
- **Layer**: 4 — Semantic Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/vector-store.ts. Define a VectorStore interface with upsert(entities, vectors), search(queryVector, topK, filter), and delete(ids). Implement PgvectorStore using postgres + pgvector. Write integration tests (Vitest, real Postgres via docker-compose).
- **Files**:
  - packages/semantic-core/src/vector-store.ts
  - packages/semantic-core/src/__tests__/vector-store.integration.test.ts
- **Depends on**: Package Manifests, Logger
- **Added**: 2026-06-04

### Task: Indexer Implementation
- **Layer**: 4 — Semantic Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete the flushBatch implementation in packages/semantic-core/src/indexer.ts. Wire up: embedding generation → cosine similarity dedup check → upsert to vector store → emit cache invalidation events. Respect the 0.85 dedup threshold from embedding-patterns.md. Add full unit tests.
- **Files**:
  - packages/semantic-core/src/indexer.ts (update existing)
  - packages/semantic-core/src/__tests__/indexer.test.ts
- **Depends on**: Embedding Service, Vector Store Interface
- **Added**: 2026-06-04

### Task: Retrieval Engine
- **Layer**: 4 — Semantic Core
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/retrieval.ts. Function queryContext(query, options) that: generates a query embedding, vector-searches for top-k entities, optionally expands via relationship graph, applies context budget (token counting), returns a compact context string. Add unit tests with mocked vector store.
- **Files**:
  - packages/semantic-core/src/retrieval.ts (update existing)
  - packages/semantic-core/src/__tests__/retrieval.test.ts
- **Depends on**: Indexer Implementation, Vector Store Interface
- **Added**: 2026-06-04

---

## Layer 5: Cache

### Task: Semantic Cache
- **Layer**: 5 — Cache
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/cache/src/semantic-cache.ts. Redis-backed cache. On lookup: generate query embedding, scan Redis for vectors with cosine similarity ≥ 0.92, return cached response if hit. On write: store query vector + response with TTL. On invalidate: remove entries related to a set of entity IDs. Full unit tests with mocked Redis.
- **Files**:
  - packages/cache/src/semantic-cache.ts (update existing)
  - packages/cache/src/__tests__/semantic-cache.test.ts
- **Depends on**: Embedding Service, Config Loader
- **Added**: 2026-06-04

### Task: Prefix Cache Manager
- **Layer**: 5 — Cache
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement packages/cache/src/prefix-cache.ts. Manages the static prefix context block (glossary + metric definitions + schema summaries) that should be kept at the front of every MCP response to maximize provider prefix cache hits. Exports buildPrefixBlock() which returns a stable, deterministic string for a given workspace. Cache it in Redis with a long TTL.
- **Files**:
  - packages/cache/src/prefix-cache.ts
  - packages/cache/src/__tests__/prefix-cache.test.ts
- **Depends on**: Config Loader, Logger
- **Added**: 2026-06-04

---

## Layer 6: Compression

### Task: Compression Pipeline
- **Layer**: 6 — Compression
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/compression/src/pipeline.ts. A chain of stages: (1) deduplicate entities by ID, (2) truncate low-relevance entities to fit contextBudget, (3) serialize to compact structured format (not raw JSON). Each stage is a pure function. Export compress(entities, budget) which runs all stages. Full unit tests with varied budgets.
- **Files**:
  - packages/compression/src/pipeline.ts (update existing)
  - packages/compression/src/stages/dedup.ts
  - packages/compression/src/stages/truncate.ts
  - packages/compression/src/stages/serialize.ts
  - packages/compression/src/__tests__/pipeline.test.ts
- **Depends on**: Package Manifests, Logger
- **Added**: 2026-06-04

---

## Layer 7: MCP Server

### Task: MCP Server Bootstrap
- **Layer**: 7 — MCP Server
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement apps/mcp-server/src/server.ts fully. Use @modelcontextprotocol/sdk to create an McpServer on stdio transport. Register the 5 tools: query-context, list-entities, get-entity, get-metric, list-glossary. Wire up services (retrieval engine, semantic cache, audit logger). All tool inputs validated with zod. Tools never throw — return errors as structured content.
- **Files**:
  - apps/mcp-server/src/server.ts (update existing)
  - apps/mcp-server/src/tools/query-context.ts
  - apps/mcp-server/src/tools/list-entities.ts
  - apps/mcp-server/src/tools/get-entity.ts
  - apps/mcp-server/src/tools/get-metric.ts
  - apps/mcp-server/src/tools/list-glossary.ts
  - apps/mcp-server/src/__tests__/server.test.ts
- **Depends on**: Retrieval Engine, Semantic Cache, Compression Pipeline
- **Added**: 2026-06-04

### Task: Audit Logger
- **Layer**: 7 — MCP Server
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement apps/mcp-server/src/audit.ts. Log every MCP tool invocation to the audit table (Postgres): timestamp, workspace_id, tool_name, query, token_estimate, cache_hit, duration_ms. Export logAuditEvent(event) and getAuditLog(workspaceId, options) with cursor pagination.
- **Files**:
  - apps/mcp-server/src/audit.ts
  - apps/mcp-server/src/__tests__/audit.test.ts
- **Depends on**: Package Manifests, Logger, Config Loader
- **Added**: 2026-06-04

---

## Layer 8: REST API

### Task: API Server Bootstrap
- **Layer**: 8 — API
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Scaffold apps/api/src/server.ts using Hono (fast, lightweight). Register route groups: /api/v1/connectors, /api/v1/entities, /api/v1/queries, /api/v1/audit. Add auth middleware (Clerk JWT). Add error handler that returns the standard envelope format per api-conventions.md. Add zod-based request validation middleware.
- **Files**:
  - apps/api/src/server.ts
  - apps/api/src/middleware/auth.ts
  - apps/api/src/middleware/error-handler.ts
  - apps/api/src/routes/connectors.ts
  - apps/api/src/routes/entities.ts
  - apps/api/src/routes/queries.ts
  - apps/api/src/routes/audit.ts
  - apps/api/src/__tests__/connectors.test.ts
- **Depends on**: Retrieval Engine, Logger, Config Loader
- **Added**: 2026-06-04

---

## Layer 9: Additional Connectors

### Task: Salesforce Connector
- **Layer**: 9 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Salesforce CRM connector in packages/connectors/salesforce/. Sync Contacts, Accounts, Opportunities via Salesforce REST API with OAuth2. Use SOQL for incremental sync (WHERE LastModifiedDate > :cursor). MSW tests.
- **Files**:
  - packages/connectors/salesforce/src/salesforce-connector.ts
  - packages/connectors/salesforce/src/manifest.ts
  - packages/connectors/salesforce/src/transformers.ts
  - packages/connectors/salesforce/src/__tests__/salesforce-connector.test.ts
  - packages/connectors/salesforce/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-04

### Task: PostgreSQL Connector
- **Layer**: 9 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Direct Postgres connector in packages/connectors/postgres/. User configures which tables to index. Connector reads table schemas, syncs rows as SemanticEntity with field names as attributes. Supports incremental sync via updated_at column. API-key auth (connection string).
- **Files**:
  - packages/connectors/postgres/src/postgres-connector.ts
  - packages/connectors/postgres/src/manifest.ts
  - packages/connectors/postgres/src/__tests__/postgres-connector.test.ts
  - packages/connectors/postgres/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-04

---

## Layer 10: Dashboard

### Task: Dashboard Scaffold
- **Layer**: 10 — Dashboard
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Scaffold apps/dashboard as a Next.js 14 app with App Router, shadcn/ui, Clerk auth. Pages: /dashboard (overview), /connectors (list + setup), /queries (audit log), /settings. Wire up to the REST API. Basic connector health status cards on overview.
- **Files**:
  - apps/dashboard/package.json
  - apps/dashboard/next.config.ts
  - apps/dashboard/app/layout.tsx
  - apps/dashboard/app/page.tsx
  - apps/dashboard/app/connectors/page.tsx
  - apps/dashboard/app/queries/page.tsx
  - apps/dashboard/components/connector-card.tsx
- **Depends on**: API Server Bootstrap
- **Added**: 2026-06-04

---

## Layer 11: Data Persistence & Glossary

### Task: Database Schema Migrations
- **Layer**: 11 — Data Persistence
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create SQL migration files in apps/api/migrations/ for the core data model. Define tables: workspaces (id, name, createdAt), connector_instances (id, workspaceId, connectorId, config, status, lastSyncedAt), glossary_terms (id, workspaceId, term, definition, exampleValue), metrics (id, workspaceId, name, formula, description). All tables use workspace_id for tenant isolation. Include indexes on (workspace_id, type) for query performance. Follow the migration naming convention: 001_initial_schema.sql, 002_add_glossary.sql, etc. Reference apps/api/src/db/migrate.ts for how migrations are executed.
- **Files**:
  - apps/api/migrations/001_initial_schema.sql
  - apps/api/migrations/002_add_glossary.sql
  - apps/api/migrations/002_add_metrics.sql
- **Depends on**: API Server Bootstrap
- **Added**: 2026-06-05

### Task: Glossary Service & API
- **Layer**: 11 — Data Persistence
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/glossary.ts with GlossaryService class. Methods: addTerm(workspaceId, term, definition, exampleValue), getTerm(workspaceId, term), listTerms(workspaceId, filter?), deleteTerm(workspaceId, term). Persist to postgres via pg pool. Wire up to apps/api/src/routes/glossary.ts with GET /api/v1/glossary, POST /api/v1/glossary (create term), DELETE /api/v1/glossary/:term endpoints. All endpoints require workspaceId. Full unit + integration tests.
- **Files**:
  - packages/semantic-core/src/glossary.ts
  - packages/semantic-core/src/__tests__/glossary.test.ts
  - packages/semantic-core/src/__tests__/glossary.integration.test.ts
  - apps/api/src/routes/glossary.ts
  - apps/api/src/__tests__/glossary.test.ts
- **Depends on**: Database Schema Migrations
- **Added**: 2026-06-05

### Task: Metric Registry Service & API
- **Layer**: 11 — Data Persistence
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/metrics.ts with MetricRegistry class. Methods: defineMetric(workspaceId, name, formula, description), getMetric(workspaceId, name), listMetrics(workspaceId), deleteMetric(workspaceId, name). Persist to postgres. Wire up to apps/api/src/routes/metrics.ts with GET /api/v1/metrics, POST /api/v1/metrics, DELETE /api/v1/metrics/:name. Update the MCP tools get-metric and list-glossary (in apps/mcp-server) to call these services instead of returning stubs. Full unit + integration tests.
- **Files**:
  - packages/semantic-core/src/metrics.ts
  - packages/semantic-core/src/__tests__/metrics.test.ts
  - packages/semantic-core/src/__tests__/metrics.integration.test.ts
  - apps/api/src/routes/metrics.ts
  - apps/api/src/__tests__/metrics.test.ts
  - apps/mcp-server/src/tools/get-metric.ts (update)
  - apps/mcp-server/src/tools/list-glossary.ts (update)
- **Depends on**: Database Schema Migrations
- **Added**: 2026-06-05

---

## Layer 12: Additional Connectors

### Task: Google Drive Connector
- **Layer**: 12 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Google Drive connector in packages/connectors/google-drive/. Sync files and folders as SemanticEntity objects. Use OAuth2 (Google API). Support incremental sync via modifiedTime cursor. Extract file content for indexing (text files only). ConnectorManifest with name, icon, OAuth scopes. MSW tests with fixture responses. See connector-patterns.md for sync generator and entity transformation rules.
- **Files**:
  - packages/connectors/google-drive/src/google-drive-connector.ts
  - packages/connectors/google-drive/src/manifest.ts
  - packages/connectors/google-drive/src/transformers.ts
  - packages/connectors/google-drive/src/__tests__/google-drive-connector.test.ts
  - packages/connectors/google-drive/tests/fixtures/files.json
  - packages/connectors/google-drive/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-05

### Task: Snowflake Connector
- **Layer**: 12 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Snowflake connector in packages/connectors/snowflake/. Allow users to configure which tables to sync. Connector reads table schemas and syncs rows as SemanticEntity objects with field names as attributes. Support incremental sync via UPDATED_AT column filter. API-key auth (account, user, password, warehouse config). MSW tests with fixture SQL responses.
- **Files**:
  - packages/connectors/snowflake/src/snowflake-connector.ts
  - packages/connectors/snowflake/src/manifest.ts
  - packages/connectors/snowflake/src/__tests__/snowflake-connector.test.ts
  - packages/connectors/snowflake/tests/fixtures/tables.json
  - packages/connectors/snowflake/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-05

### Task: Connector Instance Management API
- **Layer**: 12 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend apps/api/src/routes/connectors.ts to fully support connector instance persistence and lifecycle. Add endpoints: POST /connectors (create instance, store config in DB), GET /connectors/:id (fetch instance), PUT /connectors/:id (update config), DELETE /connectors/:id. Add POST /connectors/:id/sync (trigger sync job via BullMQ), POST /connectors/:id/test (health check). Store instance status (active|error|syncing) and lastSyncedAt. Integrate with the database schema from Database Schema Migrations task. Full tests with real DB.
- **Files**:
  - apps/api/src/routes/connectors.ts (update)
  - apps/api/src/services/connector-service.ts
  - apps/api/src/__tests__/connectors.test.ts (update)
- **Depends on**: Database Schema Migrations
- **Added**: 2026-06-05

---

## Layer 13: Sync Job Queue

### Task: BullMQ Job Queue Infrastructure
- **Layer**: 13 — Sync Job Queue
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement BullMQ-backed job queue for async connector syncs in packages/queue/. Create SyncJobQueue class with enqueueSync(connectorInstanceId), processJob(job), and handleJobCompletion(). Wire up to Redis. Update apps/api/src/routes/connectors.ts POST /connectors/:id/sync to enqueue a job instead of inline processing. Track job status in connector_instances.sync_status column. Include unit tests with mocked Redis (ioredis-mock) and integration tests with real Redis via docker-compose.
- **Files**:
  - packages/queue/src/sync-job-queue.ts
  - packages/queue/src/__tests__/sync-job-queue.test.ts
  - packages/queue/src/__tests__/sync-job-queue.integration.test.ts
  - apps/api/src/workers/sync-worker.ts
  - apps/api/migrations/004_add_sync_status.sql
- **Depends on**: Connector Instance Management API
- **Added**: 2026-06-05

---

## Layer 14: Knowledge Graph

### Task: Knowledge Graph Service (Neo4j)
- **Layer**: 14 — Knowledge Graph
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement packages/graph/src/graph-store.ts as a Neo4j interface. Define a GraphStore interface with methods: addEntity(entity), addRelationship(sourceId, targetId, type), getRelated(entityId, relationshipType, limit), removeEntity(entityId), removeRelationship(sourceId, targetId). Implement Neo4jGraphStore using neo4j-driver. Support read/write across tenants (workspaceId partition). Add unit tests with mocked Neo4j driver and integration tests with real Neo4j via docker-compose. See schema-mapper rules for entity-relationship semantics.
- **Files**:
  - packages/graph/src/graph-store.ts
  - packages/graph/src/__tests__/graph-store.test.ts
  - packages/graph/src/__tests__/graph-store.integration.test.ts
  - infra/docker/docker-compose.yml (add Neo4j service)
- **Depends on**: Vector Store Interface
- **Added**: 2026-06-05

### Task: Entity Relationship Indexing
- **Layer**: 14 — Knowledge Graph
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend packages/semantic-core/src/indexer.ts to extract and persist entity relationships during indexing. After embedding an entity, scan its attributes and relationships array, then call graphStore.addRelationship() for each. Also populate the entity_relationships table in Postgres (entity_id, related_entity_id, relationship_type, confidence_score). Update the retrieval engine to expand queries by following relationship edges (depth=1) and including related entities in context. Add unit and integration tests covering relationship discovery and expansion.
- **Files**:
  - packages/semantic-core/src/indexer.ts (update)
  - packages/semantic-core/src/retrieval.ts (update)
  - apps/api/migrations/005_add_entity_relationships.sql
  - packages/semantic-core/src/__tests__/indexer.test.ts (update)
  - packages/semantic-core/src/__tests__/retrieval.test.ts (update)
- **Depends on**: Knowledge Graph Service (Neo4j), Indexer Implementation
- **Added**: 2026-06-05

---

## Layer 15: Dashboard & Analytics

### Task: Token Analytics Service & Dashboard
- **Layer**: 15 — Dashboard & Analytics
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/token-analytics.ts with TokenAnalytics class. Methods: logQuery(workspaceId, tokensSpent, tokensSavedByCaching, tokensSavedByCompression), getAnalytics(workspaceId, timeframe). Persist to Postgres (token_events table with timestamp, workspace_id, tokens_spent, tokens_saved_caching, tokens_saved_compression). Expose GET /api/v1/analytics/tokens endpoint returning time-series data. Wire up to the dashboard at apps/dashboard/app/analytics/page.tsx with a chart showing daily token spend, cache hit rate, and compression ratio. Include unit + integration tests.
- **Files**:
  - packages/semantic-core/src/token-analytics.ts
  - packages/semantic-core/src/__tests__/token-analytics.test.ts
  - packages/semantic-core/src/__tests__/token-analytics.integration.test.ts
  - apps/api/migrations/006_add_token_events.sql
  - apps/api/src/routes/analytics.ts
  - apps/dashboard/app/analytics/page.tsx
  - apps/dashboard/components/token-chart.tsx
- **Depends on**: Compression Pipeline, Semantic Cache, MCP Server Bootstrap
- **Added**: 2026-06-05

### Task: Connector Setup UI Flow
- **Layer**: 15 — Dashboard & Analytics
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a multi-step connector setup wizard in the dashboard at apps/dashboard/app/connectors/setup/page.tsx. Step 1: select connector type (list manifests from GET /api/v1/connectors/types). Step 2: OAuth redirect or API key entry (per manifest.auth config). Step 3: schema auto-discovery (call connector.getSchema()). Step 4: field mapping confirmation (show table/column summary). Step 5: review and create instance (POST /api/v1/connectors). Use shadcn/ui Stepper component. Full tests with mocked API responses.
- **Files**:
  - apps/dashboard/app/connectors/setup/page.tsx
  - apps/dashboard/components/connector-setup-wizard.tsx
  - apps/dashboard/components/oauth-redirect-handler.tsx
  - apps/dashboard/components/schema-mapper.tsx
  - apps/dashboard/app/connectors/setup/__tests__/page.test.tsx
- **Depends on**: Dashboard Scaffold, Connector Instance Management API
- **Added**: 2026-06-05

---

## Layer 16: Production Hardening

### Task: MCP Server API Key Authentication & Workspace Isolation
- **Layer**: 16 — Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement API key-based authentication for the MCP server to enforce workspace isolation and access control. Create apps/api/migrations/007_add_mcp_api_keys.sql with tables: mcp_api_keys (id, workspace_id, key_hash, display_name, createdAt, lastUsedAt, revokedAt) and mcp_audit_sessions (session_id, api_key_id, workspace_id, connectedAt, disconnectedAt). Update apps/mcp-server/src/server.ts to validate incoming MCP requests via an API key passed in the MCP initialize message (or via StdioServerTransport metadata). Ensure all MCP tools check workspace_id from the authenticated key and return 403 if accessing resources outside that workspace. Add integration tests with real Postgres. Reference api-conventions.md for auth patterns.
- **Files**:
  - apps/api/migrations/007_add_mcp_api_keys.sql
  - packages/semantic-core/src/api-key-manager.ts
  - apps/mcp-server/src/auth.ts
  - apps/mcp-server/src/server.ts (update)
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/mcp-server/src/tools/list-entities.ts (update)
  - apps/mcp-server/src/tools/get-entity.ts (update)
  - apps/mcp-server/src/tools/get-metric.ts (update)
  - apps/mcp-server/src/tools/list-glossary.ts (update)
  - packages/semantic-core/src/__tests__/api-key-manager.test.ts
  - apps/mcp-server/src/__tests__/auth.test.ts
  - apps/mcp-server/src/__tests__/server.integration.test.ts
- **Depends on**: MCP Server Bootstrap
- **Added**: 2026-06-05

### Task: REST API Rate Limiting & Request Throttling
- **Layer**: 16 — Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement rate limiting middleware for the REST API to prevent abuse and ensure fair resource usage. Create apps/api/src/middleware/rate-limiter.ts using Redis-backed sliding window counters with per-workspace limits. Defaults: 100 requests/minute per workspace, 10 requests/minute for sync triggers (POST /api/v1/connectors/:id/sync). Make limits configurable via env vars. Return 429 with Retry-After header when exceeded. Update apps/api/src/server.ts to register the middleware globally and selectively per route. Add unit tests with mocked Redis and integration tests with real Redis. See api-conventions.md for HTTP status code rules.
- **Files**:
  - apps/api/src/middleware/rate-limiter.ts
  - apps/api/src/server.ts (update)
  - apps/api/src/__tests__/rate-limiter.test.ts
  - apps/api/src/__tests__/rate-limiter.integration.test.ts
- **Depends on**: API Server Bootstrap
- **Added**: 2026-06-05

### Task: Sync Worker Implementation & Connector Invocation
- **Layer**: 16 — Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete the sync-worker.ts stub in apps/api/src/workers/sync-worker.ts to actually execute connector syncs. The worker should: (1) look up the connector instance from the database, (2) instantiate the registered connector with its config, (3) call connector.sync() to get an AsyncGenerator of entities, (4) yield entities to the semantic indexer (packages/semantic-core/src/indexer.ts), (5) update connector_instances.lastSyncedAt on completion, (6) emit sync events to an audit log. Handle errors with retry logic (3 retries, exponential backoff already configured in BullMQ). Log sync start/progress/completion. Add integration tests with mocked Postgres and a real Redis queue.
- **Files**:
  - apps/api/src/workers/sync-worker.ts (update)
  - apps/api/src/workers/__tests__/sync-worker.integration.test.ts
  - packages/semantic-core/src/sync-events.ts (new)
- **Depends on**: BullMQ Job Queue Infrastructure, Connector Instance Management API
- **Added**: 2026-06-05

### Task: E2E Tests for Critical User Flows
- **Layer**: 16 — Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Write end-to-end tests using Playwright in tests/e2e/ covering critical user flows: (1) Dashboard connector setup flow (select type → OAuth → schema discovery → create instance), (2) MCP query flow (authenticate with API key → query-context returns relevant entities → cache hit on repeat query), (3) Token analytics flow (trigger sync → verify tokens logged → check analytics page shows usage). Tests should use real API server and MCP server running locally, with Postgres and Redis via docker-compose. Include fixtures for connector OAuth mocks and test data. Target: 3–5 test suites with 10–15 tests total.
- **Files**:
  - tests/e2e/connector-setup.spec.ts
  - tests/e2e/mcp-query.spec.ts
  - tests/e2e/token-analytics.spec.ts
  - tests/e2e/fixtures/auth-mocks.ts
  - tests/e2e/utils/test-setup.ts
  - tests/playwright.config.ts
- **Depends on**: Connector Setup UI Flow, MCP Server Bootstrap, Token Analytics Service & Dashboard
- **Added**: 2026-06-05

### Task: Connector Health Monitoring & Dashboard Integration
- **Layer**: 16 — Production Hardening
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Complete connector health monitoring by: (1) extending packages/semantic-core/src to export a ConnectorHealthService that periodically calls connector.healthCheck() for each active instance and stores results in a new connector_health table (instance_id, status, lastChecked, errorMessage), (2) wiring the service into apps/api/src/routes/connectors.ts to expose GET /api/v1/connectors/:id/health and GET /api/v1/connectors/health (all instances), (3) building a dashboard component at apps/dashboard/components/connector-health-card.tsx showing live status (green/yellow/red), lastSyncedAt, and error details if unhealthy. Add health check triggers on sync completion and manual refresh endpoint. Full tests with mocked health responses.
- **Files**:
  - packages/semantic-core/src/connector-health-service.ts
  - apps/api/migrations/008_add_connector_health.sql
  - apps/api/src/routes/connectors.ts (update)
  - apps/dashboard/components/connector-health-card.tsx
  - apps/dashboard/app/connectors/page.tsx (update)
  - packages/semantic-core/src/__tests__/connector-health-service.test.ts
  - apps/api/src/__tests__/connectors.test.ts (update)
- **Depends on**: BullMQ Job Queue Infrastructure, Connector Instance Management API
- **Added**: 2026-06-05

---

## Layer 17: Advanced Connectors & V1 Features

### Task: Airtable Connector
- **Layer**: 17 — Advanced Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Airtable connector in packages/connectors/airtable/. Connect via OAuth2 to Airtable API. Sync bases, tables, and records as SemanticEntity objects. Support incremental sync via lastModifiedTime filtering. Extract field schema from Airtable's field definitions. Use MSW for tests with fixture responses from Airtable API. Include ConnectorManifest with icon and OAuth scope configuration.
- **Files**:
  - packages/connectors/airtable/src/airtable-connector.ts
  - packages/connectors/airtable/src/manifest.ts
  - packages/connectors/airtable/src/transformers.ts
  - packages/connectors/airtable/src/__tests__/airtable-connector.test.ts
  - packages/connectors/airtable/tests/fixtures/bases.json
  - packages/connectors/airtable/tests/fixtures/records.json
  - packages/connectors/airtable/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-05

### Task: Slack Connector
- **Layer**: 17 — Advanced Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Slack connector in packages/connectors/slack/. Connect via OAuth2 to Slack API. Sync channels, users, and messages as SemanticEntity objects. Support incremental sync via ts cursor (message timestamps). Extract user profiles and channel metadata. Apply workspace filtering based on connector config. Use MSW for tests. Reference connector-patterns.md for async generator and entity transformation rules. Include ConnectorManifest.
- **Files**:
  - packages/connectors/slack/src/slack-connector.ts
  - packages/connectors/slack/src/manifest.ts
  - packages/connectors/slack/src/transformers.ts
  - packages/connectors/slack/src/__tests__/slack-connector.test.ts
  - packages/connectors/slack/tests/fixtures/channels.json
  - packages/connectors/slack/tests/fixtures/users.json
  - packages/connectors/slack/tests/fixtures/messages.json
  - packages/connectors/slack/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-05

### Task: Index Status & Coverage Metrics
- **Layer**: 17 — Advanced Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement IndexStatusService in packages/semantic-core/src/index-status.ts to track index health and coverage. Methods: recordEntityIndex(workspaceId, entityCount, totalBytes), getIndexStatus(workspaceId) returning {totalEntities, totalBytes, lastIndexedAt, coverageByType}. Persist to Postgres (index_status table with workspace_id, entity_type, entity_count, indexed_at). Expose GET /api/v1/index/status endpoint in apps/api/src/routes/index.ts. Build dashboard component at apps/dashboard/components/index-coverage-card.tsx showing entity breakdown by type and total indexed content size. Full unit + integration tests.
- **Files**:
  - packages/semantic-core/src/index-status.ts
  - apps/api/migrations/009_add_index_status.sql
  - apps/api/src/routes/index.ts
  - apps/dashboard/components/index-coverage-card.tsx
  - packages/semantic-core/src/__tests__/index-status.test.ts
  - packages/semantic-core/src/__tests__/index-status.integration.test.ts
  - apps/api/src/__tests__/index.test.ts
- **Depends on**: Indexer Implementation, Semantic Cache
- **Added**: 2026-06-05

### Task: Sync Scheduling & Frequency Configuration
- **Layer**: 17 — Advanced Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend connector_instances table and sync job infrastructure to support configurable sync frequency. Add migration 010_add_sync_schedule.sql with fields: sync_frequency (real-time|hourly|daily|weekly|manual), sync_schedule_cron (for custom schedules), syncStartTime (for daily/weekly). Implement SyncScheduleService in packages/queue/src/sync-schedule-service.ts to manage recurring sync jobs via node-cron and BullMQ repeatable jobs. Update the dashboard connector setup wizard (apps/dashboard/app/connectors/setup/page.tsx) step 4 to include frequency picker. Wire up GET/PUT /api/v1/connectors/:id/schedule endpoints. Full tests with fake timers (vi.useFakeTimers()).
- **Files**:
  - apps/api/migrations/010_add_sync_schedule.sql
  - packages/queue/src/sync-schedule-service.ts
  - packages/queue/src/__tests__/sync-schedule-service.test.ts
  - apps/api/src/routes/connectors.ts (update)
  - apps/dashboard/app/connectors/setup/page.tsx (update)
  - apps/api/src/__tests__/connectors.test.ts (update)
- **Depends on**: BullMQ Job Queue Infrastructure, Connector Instance Management API
- **Added**: 2026-06-05

### Task: Webhook-Driven Real-Time Sync
- **Layer**: 17 — Advanced Connectors
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement webhook support for real-time connector syncs. Create apps/api/src/routes/webhooks.ts with POST /api/v1/webhooks/:connectorInstanceId/:secret to receive vendor webhook events (HubSpot, Slack, etc.). Validate webhook signatures per vendor. Convert webhook payloads to SemanticEntity deltas and feed them directly into the semantic indexer (trigger incremental update, not full sync). Store webhook verification tokens in connector_instances table. Add webhook registration logic to each connector (HubSpot, Slack, etc.) in their setup flow. Include tests with mocked webhook payloads and signature validation.
- **Files**:
  - apps/api/src/routes/webhooks.ts
  - apps/api/migrations/011_add_webhook_endpoints.sql
  - packages/connectors/hubspot/src/webhook-handler.ts
  - packages/connectors/slack/src/webhook-handler.ts
  - apps/api/src/__tests__/webhooks.test.ts
  - packages/connectors/hubspot/src/__tests__/webhook-handler.test.ts
- **Depends on**: Sync Worker Implementation & Connector Invocation, Slack Connector
- **Added**: 2026-06-05

---

## Layer 18: Additional Connectors & V1 Enhancements

### Task: Query Decomposition & Entity Type Detection
- **Layer**: 18 — Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement QueryDecomposer service in packages/semantic-core/src/query-decomposer.ts to analyze incoming queries and extract: entity types mentioned or implied, data domains (sales, finance, ops), relevance keywords. Use OpenAI's text-davinci-003 or gpt-4o-mini for lightweight NLP analysis (cached to reduce cost). Export detectEntityTypes(query, schema) and getDomainKeywords(query). Integrate into retrieval engine to pre-filter vector search results and improve relevance. Add unit tests with varied business queries and schema configurations.
- **Files**:
  - packages/semantic-core/src/query-decomposer.ts
  - packages/semantic-core/src/__tests__/query-decomposer.test.ts
  - packages/semantic-core/src/retrieval.ts (update)
- **Depends on**: Retrieval Engine
- **Added**: 2026-06-06

### Task: Jira Connector
- **Layer**: 18 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Jira connector in packages/connectors/jira/. Connect via OAuth2 to Jira Cloud API. Sync projects, issues, and epics as SemanticEntity objects. Support incremental sync via updated >= cursor. Extract issue metadata (status, assignee, labels, custom fields). Apply workspace filtering via JQL. Use MSW for tests with fixture responses. Include ConnectorManifest with icon and OAuth scope configuration. Follow connector-patterns.md for entity transformation and sync generator rules.
- **Files**:
  - packages/connectors/jira/src/jira-connector.ts
  - packages/connectors/jira/src/manifest.ts
  - packages/connectors/jira/src/transformers.ts
  - packages/connectors/jira/src/__tests__/jira-connector.test.ts
  - packages/connectors/jira/tests/fixtures/issues.json
  - packages/connectors/jira/tests/fixtures/projects.json
  - packages/connectors/jira/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-06

### Task: Confluence Connector
- **Layer**: 18 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Confluence connector in packages/connectors/confluence/. Connect via OAuth2 to Confluence Cloud API. Sync pages, spaces, and content as SemanticEntity objects. Extract text content and metadata (author, lastModified, labels). Support incremental sync via lastUpdatedDate cursor. Convert page hierarchy into entity relationships (page.parent_id). Use MSW for tests. Include ConnectorManifest with OAuth configuration. Follow connector-patterns.md for entity transformation rules.
- **Files**:
  - packages/connectors/confluence/src/confluence-connector.ts
  - packages/connectors/confluence/src/manifest.ts
  - packages/connectors/confluence/src/transformers.ts
  - packages/connectors/confluence/src/__tests__/confluence-connector.test.ts
  - packages/connectors/confluence/tests/fixtures/pages.json
  - packages/connectors/confluence/tests/fixtures/spaces.json
  - packages/connectors/confluence/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-06

### Task: Role-Based Context Segmentation
- **Layer**: 18 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement role-based context access control. Create apps/api/migrations/012_add_context_permissions.sql with tables: context_roles (id, workspace_id, role_name, description), role_entity_type_permissions (role_id, entity_type, allowed_fields). Implement ContextPermissionService in packages/semantic-core/src/context-permissions.ts with methods: filterContextByRole(context, role, schema) that removes unauthorized entity types and fields. Update retrieval engine and all MCP tools (query-context, list-entities, get-entity) to filter results per API key's assigned role. Add unit + integration tests verifying access control enforcement.
- **Files**:
  - apps/api/migrations/012_add_context_permissions.sql
  - packages/semantic-core/src/context-permissions.ts
  - packages/semantic-core/src/__tests__/context-permissions.test.ts
  - packages/semantic-core/src/retrieval.ts (update)
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/mcp-server/src/tools/list-entities.ts (update)
  - apps/mcp-server/src/tools/get-entity.ts (update)
- **Depends on**: MCP Server API Key Authentication & Workspace Isolation
- **Added**: 2026-06-06

### Task: Knowledge Graph Visualization Dashboard
- **Layer**: 18 — Additional Connectors
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a knowledge graph visualization page in the dashboard at apps/dashboard/app/graph/page.tsx. Use react-force-graph or similar library to render entity nodes and relationship edges. Allow filtering by entity type and relationship type. Support clicking an entity to show details (attributes, relationships, source connector). Support expanding relationships to depth-N. Fetch graph data from a new GET /api/v1/graph/query endpoint that returns nodes/edges. Include search by entity label and fulltext attributes. Target: functional graph visualization with filter and detail panels.
- **Files**:
  - apps/dashboard/app/graph/page.tsx
  - apps/dashboard/components/graph-visualization.tsx
  - apps/dashboard/components/entity-detail-panel.tsx
  - apps/api/src/routes/graph.ts
  - apps/api/src/__tests__/graph.test.ts
- **Depends on**: Entity Relationship Indexing, Knowledge Graph Service (Neo4j)
- **Added**: 2026-06-06

---

## Layer 19: Additional Connectors & V1 Completion

### Task: Linear Connector
- **Layer**: 19 — Additional Connectors & V1 Completion
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Linear connector in packages/connectors/linear/. Connect via OAuth2 to Linear API. Sync issues, projects, and cycles as SemanticEntity objects. Support incremental sync via updatedAt cursor. Extract issue metadata (status, priority, assignee, labels, team). Include ConnectorManifest with icon and OAuth scope configuration. Use MSW for tests with fixture responses. Follow connector-patterns.md for entity transformation and sync generator rules.
- **Files**:
  - packages/connectors/linear/src/linear-connector.ts
  - packages/connectors/linear/src/manifest.ts
  - packages/connectors/linear/src/transformers.ts
  - packages/connectors/linear/src/__tests__/linear-connector.test.ts
  - packages/connectors/linear/tests/fixtures/issues.json
  - packages/connectors/linear/tests/fixtures/projects.json
  - packages/connectors/linear/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-06

### Task: NetSuite Connector
- **Layer**: 19 — Additional Connectors & V1 Completion
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement NetSuite connector in packages/connectors/netsuite/. Connect via OAuth2 to NetSuite REST API. Sync customers, vendors, items, and transactions as SemanticEntity objects. Support incremental sync via lastModifiedDate filtering. Extract entity metadata (subsidiary, status, categories). Handle rate limiting per NetSuite's API guidance. Use MSW for tests with fixture responses. Include ConnectorManifest with OAuth scope configuration following connector-patterns.md.
- **Files**:
  - packages/connectors/netsuite/src/netsuite-connector.ts
  - packages/connectors/netsuite/src/manifest.ts
  - packages/connectors/netsuite/src/transformers.ts
  - packages/connectors/netsuite/src/__tests__/netsuite-connector.test.ts
  - packages/connectors/netsuite/tests/fixtures/customers.json
  - packages/connectors/netsuite/tests/fixtures/items.json
  - packages/connectors/netsuite/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-06

### Task: QuickBooks Connector
- **Layer**: 19 — Additional Connectors & V1 Completion
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement QuickBooks connector in packages/connectors/quickbooks/. Connect via OAuth2 to QuickBooks Online API. Sync customers, vendors, invoices, and expense transactions as SemanticEntity objects. Support incremental sync via TxnDate filtering. Extract financial metadata (account, amount, status). Handle QuickBooks' 10-minute rate limit with backoff. Use MSW for tests. Include ConnectorManifest with OAuth configuration per connector-patterns.md.
- **Files**:
  - packages/connectors/quickbooks/src/quickbooks-connector.ts
  - packages/connectors/quickbooks/src/manifest.ts
  - packages/connectors/quickbooks/src/transformers.ts
  - packages/connectors/quickbooks/src/__tests__/quickbooks-connector.test.ts
  - packages/connectors/quickbooks/tests/fixtures/customers.json
  - packages/connectors/quickbooks/tests/fixtures/invoices.json
  - packages/connectors/quickbooks/package.json
- **Depends on**: HubSpot Connector
- **Added**: 2026-06-06

### Task: OSI (Open Semantic Interchange) Standard Export
- **Layer**: 19 — Additional Connectors & V1 Completion
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement OSI standard export functionality to allow Iris index data to be exported in an open, portable format. Create packages/semantic-core/src/osi-exporter.ts with exportToOSI(workspaceId, options) that queries the semantic index and transforms entities into OSI standard JSON-LD format. Include entity types, relationships, glossary terms, and metric definitions. Expose GET /api/v1/export/osi endpoint in apps/api/src/routes/export.ts with optional filters (entity types, date range). Add unit tests with schema validation against OSI spec and integration tests verifying round-trip export/import. See embedding-patterns.md for data structuring rules.
- **Files**:
  - packages/semantic-core/src/osi-exporter.ts
  - packages/semantic-core/src/__tests__/osi-exporter.test.ts
  - packages/semantic-core/src/__tests__/osi-exporter.integration.test.ts
  - apps/api/src/routes/export.ts
  - apps/api/src/__tests__/export.test.ts
- **Depends on**: Indexer Implementation, Metric Registry Service & API, Glossary Service & API
- **Added**: 2026-06-06

### Task: Business Glossary Sharing & Collaboration Features
- **Layer**: 19 — Additional Connectors & V1 Completion
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance glossary management with team collaboration features. Update packages/semantic-core/src/glossary.ts to add: termApprovals (workflows for business term standardization), glossaryVersionHistory (track term definition changes), termUsageTracking (count how often a term appears in indexed entities). Extend apps/api/src/routes/glossary.ts with PUT /api/v1/glossary/:term/approve, GET /api/v1/glossary/:term/history, GET /api/v1/glossary/usage endpoints. Build dashboard component at apps/dashboard/components/glossary-collaborator.tsx showing term suggestions, approval queue, and usage analytics. Add audit logging for all glossary changes. Full unit + integration tests.
- **Files**:
  - packages/semantic-core/src/glossary.ts (update)
  - apps/api/migrations/013_add_glossary_collaboration.sql
  - apps/api/src/routes/glossary.ts (update)
  - apps/dashboard/components/glossary-collaborator.tsx
  - packages/semantic-core/src/__tests__/glossary.test.ts (update)
  - apps/api/src/__tests__/glossary.test.ts (update)
- **Depends on**: Glossary Service & API
- **Added**: 2026-06-06

---

## Layer 20: V2 Features & Production Hardening

### Task: Fine-Grained PII & Sensitive Field Masking
- **Layer**: 20 — V2 Features & Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive PII detection and field-level masking to protect sensitive data in the context layer. Extend connector schemas to support pii: true flag on fields (email, phone, SSN, credit card, etc.). Create packages/semantic-core/src/pii-masker.ts with detectPII(entity, schema) returning masked entity and maskingStrategy(fieldName, fieldType) supporting: redaction (***), hashing (one-way), tokenization (reversible). Integrate into indexer pipeline before embedding and storage. Add dashboard UI at apps/dashboard/components/pii-config-panel.tsx to define custom PII patterns per workspace. Update MCP tools (query-context, get-entity, list-entities) to apply PII masking per API key's role permissions. Full unit + integration tests with GDPR/HIPAA masking examples. See code-style.md for error handling patterns.
- **Files**:
  - packages/semantic-core/src/pii-masker.ts
  - packages/semantic-core/src/__tests__/pii-masker.test.ts
  - packages/semantic-core/src/__tests__/pii-masker.integration.test.ts
  - apps/api/migrations/014_add_pii_config.sql
  - apps/api/src/routes/pii-config.ts
  - apps/dashboard/components/pii-config-panel.tsx
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/mcp-server/src/tools/get-entity.ts (update)
  - apps/mcp-server/src/tools/list-entities.ts (update)
- **Depends on**: Role-Based Context Segmentation
- **Added**: 2026-06-07

### Task: Schema Auto-Discovery with Human-in-the-Loop Confirmation
- **Layer**: 20 — V2 Features & Production Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a guided schema discovery workflow for connectors that lack native schema support (CSV, JSON files, custom APIs). Create packages/semantic-core/src/schema-discoverer.ts with discoverSchema(connector, sampleData) using heuristics (field names, value patterns, type inference) to infer entity types and attributes. Implement human-in-the-loop confirmation UI at apps/dashboard/app/connectors/setup/[id]/schema-review/page.tsx where users can: accept/reject inferred fields, rename fields, mark PII fields, define entity type relationships. Wire up POST /api/v1/connectors/:id/schema-confirmation endpoint to persist user decisions. Store schema overrides in connector_instances table. Add unit tests with varied data formats (CSV, JSON, Parquet). See connector-patterns.md for entity transformation validation.
- **Files**:
  - packages/semantic-core/src/schema-discoverer.ts
  - packages/semantic-core/src/__tests__/schema-discoverer.test.ts
  - apps/api/migrations/015_add_schema_overrides.sql
  - apps/api/src/routes/connectors.ts (update)
  - apps/dashboard/app/connectors/setup/[id]/schema-review/page.tsx
  - apps/dashboard/components/schema-field-mapper.tsx
- **Depends on**: Connector Instance Management API, Connector Setup UI Flow
- **Added**: 2026-06-07

### Task: Proactive Context Surfacing (V2 Intelligence)
- **Layer**: 20 — V2 Features & Production Hardening
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement proactive context delivery that surfaces relevant information to AI agents before they request it. Create packages/semantic-core/src/proactive-suggester.ts with suggestContext(workspaceId, userId, recentActivity) analyzing user's recent MCP queries to predict what context they'll need next. Build a suggestion engine using: (1) entity co-occurrence patterns from semantic index, (2) user role and typical workflows, (3) time-of-day patterns (sales queries at different times than finance). Expose GET /api/v1/context-suggestions endpoint returning top-3 suggested entities/metrics. Build dashboard widget at apps/dashboard/components/context-suggestions-widget.tsx showing suggestions on main dashboard. Wire up to MCP server to optionally include suggestions in response metadata. Full tests with activity pattern fixtures.
- **Files**:
  - packages/semantic-core/src/proactive-suggester.ts
  - packages/semantic-core/src/__tests__/proactive-suggester.test.ts
  - apps/api/migrations/016_add_context_suggestions.sql
  - apps/api/src/routes/suggestions.ts
  - apps/dashboard/components/context-suggestions-widget.tsx
  - apps/mcp-server/src/suggestions.ts
- **Depends on**: Query Decomposition & Entity Type Detection, Token Analytics Service & Dashboard
- **Added**: 2026-06-07

### Task: Advanced Index Optimization & Query Performance
- **Layer**: 20 — V2 Features & Production Hardening
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Optimize semantic index performance for large datasets (1M+ entities) via: (1) partial index optimization (index only top-k relevant entities per type), (2) read-only vector index caching in memory (LRU, size-bounded), (3) query result pre-computation for common queries, (4) lazy entity hydration (store minimal data initially, fetch attributes on demand). Implement IndexOptimizer service in packages/semantic-core/src/index-optimizer.ts with analyze(workspaceId) scanning query patterns and recommending optimizations. Add admin UI at apps/dashboard/components/index-optimizer-panel.tsx showing index size, hot entities, and optimization suggestions. Extend IndexStatusService to track cache hit rates and optimization benefits. Add integration tests with large synthetic datasets (100K+ entities). Reference embedding-patterns.md for cost control rules.
- **Files**:
  - packages/semantic-core/src/index-optimizer.ts
  - packages/semantic-core/src/__tests__/index-optimizer.integration.test.ts
  - packages/cache/src/index-cache.ts
  - apps/api/src/routes/index-optimization.ts
  - apps/dashboard/components/index-optimizer-panel.tsx
  - packages/semantic-core/src/retrieval.ts (update)
- **Depends on**: Index Status & Coverage Metrics, Semantic Cache
- **Added**: 2026-06-07

---

## Layer 21: Multi-Tenant & Advanced V2 Features

### Task: Multi-Tenant Support & Workspace Isolation
- **Layer**: 21 — Multi-Tenant & Advanced V2 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement complete multi-tenant isolation across all APIs and data stores. Update database schema with tenant-aware constraints: add workspace_id foreign keys to all tables, ensure row-level security policies prevent cross-tenant data leakage. Extend apps/api/src/middleware/auth.ts to extract workspace_id from Clerk organization context and validate against API key assignments. Update retrieval engine and semantic cache to enforce workspace isolation in all queries. Add MCP tool workspace filtering. Create apps/api/migrations/017_add_tenant_constraints.sql. Build dashboard workspace selector at apps/dashboard/components/workspace-selector.tsx with switching logic. Add comprehensive integration tests verifying cross-workspace isolation (attempt queries from WS-A in WS-B context, verify 403 response). Reference api-conventions.md for auth patterns.
- **Files**:
  - apps/api/migrations/017_add_tenant_constraints.sql
  - apps/api/src/middleware/auth.ts (update)
  - packages/semantic-core/src/retrieval.ts (update)
  - packages/cache/src/semantic-cache.ts (update)
  - apps/api/src/routes/connectors.ts (update)
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/mcp-server/src/tools/list-entities.ts (update)
  - apps/mcp-server/src/tools/get-entity.ts (update)
  - apps/mcp-server/src/tools/get-metric.ts (update)
  - apps/mcp-server/src/tools/list-glossary.ts (update)
  - apps/dashboard/components/workspace-selector.tsx
  - apps/api/src/__tests__/multi-tenant-isolation.integration.test.ts
- **Depends on**: MCP Server API Key Authentication & Workspace Isolation
- **Added**: 2026-06-07

### Task: Natural Language Index Configuration
- **Layer**: 21 — Multi-Tenant & Advanced V2 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable business users to configure fiscal calendars, date interpretations, and metric calculations in plain English. Create packages/semantic-core/src/nlp-config-parser.ts with parseConfigNL(nlText, schema) that uses gpt-4o-mini to interpret natural language config statements like "our fiscal year starts in February" and "ARR is MRR times 12 annualized on Jan 31". Store parsed configs in workspace_nlp_configs table (workspace_id, config_type, input_text, parsed_json, interpretedAt). Expose POST /api/v1/workspace/config-from-language endpoint in apps/api/src/routes/workspace-config.ts. Build wizard page at apps/dashboard/app/workspace/nlp-setup/page.tsx with textarea input, parsing feedback, and approval flow. Wire up interpreted configs into metric registry and glossary. Full unit tests with varied business terminology samples (accounting terms, sales cycles, inventory models). Reference embedding-patterns.md for prompt token budgeting.
- **Files**:
  - packages/semantic-core/src/nlp-config-parser.ts
  - packages/semantic-core/src/__tests__/nlp-config-parser.test.ts
  - apps/api/migrations/018_add_workspace_nlp_configs.sql
  - apps/api/src/routes/workspace-config.ts
  - apps/dashboard/app/workspace/nlp-setup/page.tsx
  - apps/dashboard/components/nlp-config-wizard.tsx
  - apps/api/src/__tests__/workspace-config.test.ts
- **Depends on**: Metric Registry Service & API, Query Decomposition & Entity Type Detection
- **Added**: 2026-06-07

### Task: Agent Workflow Templates with Pre-Configured Iris Context
- **Layer**: 21 — Multi-Tenant & Advanced V2 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build pre-configured workflow templates that agents can use to query Iris context automatically. Create packages/semantic-core/src/workflow-templates.ts with WorkflowTemplate class containing: template name, description, trigger conditions (on calendar, on entity change, manual), MCP tool calls (query-context with specific entity types/keywords), and response format (for Claude, ChatGPT, etc.). Implement apps/api/routes/workflow-templates.ts with CRUD endpoints: GET /api/v1/workflow-templates, POST /api/v1/workflow-templates (create), PUT /api/v1/workflow-templates/:id, DELETE /api/v1/workflow-templates/:id. Build template gallery dashboard at apps/dashboard/app/workflows/page.tsx showcasing templates (e.g., "Daily Sales Summary", "Weekly Finance Review", "Customer Health Check"). Store templates in workflow_templates table (workspace_id, template_name, mcp_calls, triggers). Add E2E test verifying template can be created, viewed, and triggered. Reference api-conventions.md for REST patterns.
- **Files**:
  - packages/semantic-core/src/workflow-templates.ts
  - packages/semantic-core/src/__tests__/workflow-templates.test.ts
  - apps/api/migrations/019_add_workflow_templates.sql
  - apps/api/src/routes/workflow-templates.ts
  - apps/dashboard/app/workflows/page.tsx
  - apps/dashboard/components/workflow-template-gallery.tsx
  - apps/dashboard/components/workflow-template-editor.tsx
  - apps/api/src/__tests__/workflow-templates.test.ts
- **Depends on**: MCP Server Bootstrap, Proactive Context Surfacing (V2 Intelligence)
- **Added**: 2026-06-07

### Task: Cross-Company Benchmarking (Anonymized & Opt-In)
- **Layer**: 21 — Multi-Tenant & Advanced V2 Features
- **Status**: COMMITTED
- **Priority**: Low
- **Description**: Implement optional aggregated benchmarking data to help customers compare their index usage, entity counts, and context queries against anonymized industry peers. Create packages/semantic-core/src/benchmarking.ts with BenchmarkingService that: (1) collects workspace metrics (entity_count, query_count, avg_context_size, token_savings_ratio) via GET /api/v1/workspace/benchmark-snapshot, (2) optionally publishes to central benchmarking service (with workspace_id hashed + anonymized), (3) queries benchmarks for peer group (same company size, industry) and returns percentile ranks (e.g., "you're in top 25% for token savings"). Store opt-in consent in workspace_settings table (benchmarking_enabled boolean). Build dashboard widget at apps/dashboard/components/benchmarking-card.tsx showing current metrics vs peer benchmarks (box plots). Add unit tests with synthetic benchmark data. Reference testing.md for data fixture patterns.
- **Files**:
  - packages/semantic-core/src/benchmarking.ts
  - packages/semantic-core/src/__tests__/benchmarking.test.ts
  - apps/api/migrations/020_add_workspace_benchmarking.sql
  - apps/api/src/routes/workspace-benchmarking.ts
  - apps/dashboard/components/benchmarking-card.tsx
  - apps/api/src/__tests__/workspace-benchmarking.test.ts
- **Depends on**: Token Analytics Service & Dashboard, Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

---

## Layer 22: API Wiring & Integration

### Task: Workflow Templates API Routes & Server Registration
- **Layer**: 22 — API Wiring & Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete workflow templates integration by: (1) creating apps/api/src/routes/workflow-templates.ts with full CRUD endpoints (GET /api/v1/workflow-templates, POST, PUT /:id, DELETE /:id) following api-conventions.md (paginated responses, standard error envelope, workspace isolation via auth middleware); (2) wiring the routes into apps/api/src/server.ts via createWorkflowTemplateRoutes and register with authed.route('/workflow-templates', ...); (3) exporting WorkflowTemplate types from packages/semantic-core/src/index.ts; (4) adding integration tests verifying CRUD operations, workspace isolation (cross-workspace access returns 403), and error handling. Reference the existing glossary/metrics routes for pattern reuse.
- **Files**:
  - apps/api/src/routes/workflow-templates.ts
  - apps/api/src/server.ts (update)
  - packages/semantic-core/src/index.ts (update)
  - apps/api/src/__tests__/workflow-templates.test.ts
- **Depends on**: Agent Workflow Templates with Pre-Configured Iris Context
- **Added**: 2026-06-07

### Task: Workspace Configuration Routes & Server Registration
- **Layer**: 22 — API Wiring & Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Wire the created workspace-config routes into the main API server. Update apps/api/src/server.ts to import createWorkspaceConfigRoutes and register with authed.route('/workspace/config', ...). Verify integration tests confirm that NL config parsing, approval flow, and config persistence work end-to-end. Ensure workspace isolation is enforced (users can only access/modify their own workspace configs). Add missing integration tests to validate GET workspace metrics vs config, PUT to update interpreted settings, and DELETE to reset. Reference api-conventions.md for auth and response envelope patterns.
- **Files**:
  - apps/api/src/server.ts (update)
  - apps/api/src/__tests__/workspace-config.test.ts (update)
- **Depends on**: Natural Language Index Configuration
- **Added**: 2026-06-07

### Task: Workflow Templates Dashboard Pages
- **Layer**: 22 — API Wiring & Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build complete workflow templates dashboard UI at apps/dashboard/app/workflows/page.tsx with: (1) gallery view showing all templates (GET /api/v1/workflow-templates), (2) template cards with name, description, trigger type, and action count, (3) "Create Template" button opening modal with template editor component (name, description, MCP tool picker, trigger condition selector), (4) edit/delete actions per template, (5) apply/disable templates with toggle. Create components: WorkflowTemplateGallery (card grid layout), WorkflowTemplateEditor (form with validation), TemplatePreview (shows MCP calls and trigger config). Add E2E test verifying full flow: create template -> view in gallery -> edit -> trigger condition change -> delete. Reference dashboard components (shadcn/ui) for styling consistency.
- **Files**:
  - apps/dashboard/app/workflows/page.tsx
  - apps/dashboard/components/workflow-template-gallery.tsx
  - apps/dashboard/components/workflow-template-editor.tsx
  - apps/dashboard/components/workflow-template-preview.tsx
  - apps/dashboard/app/workflows/__tests__/page.test.tsx
  - tests/e2e/workflow-management.spec.ts
- **Depends on**: Workflow Templates API Routes & Server Registration
- **Added**: 2026-06-07

### Task: Benchmarking Service Implementation & API
- **Layer**: 22 — API Wiring & Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement complete benchmarking functionality. Create packages/semantic-core/src/benchmarking.ts with BenchmarkingService: (1) collectMetrics(workspaceId) aggregates token_events, entity counts, query patterns from Postgres; (2) getPeerBenchmarks(workspaceId, industry, companySize) queries hashed peer data and returns percentile rankings (25th, 50th, 75th, 90th percentiles); (3) exportMetrics(workspaceId) returns shareable JSON for opt-in aggregation. Create apps/api/migrations/020_add_workspace_benchmarking.sql with workspace_benchmarking table. Create apps/api/src/routes/workspace-benchmarking.ts with GET /api/v1/workspace/benchmark-snapshot, GET /api/v1/workspace/benchmarks/peer-comparison endpoints. Export BenchmarkingService from semantic-core/index.ts. Add comprehensive unit + integration tests with synthetic benchmark fixture data. Wire into server.ts.
- **Files**:
  - packages/semantic-core/src/benchmarking.ts
  - packages/semantic-core/src/__tests__/benchmarking.test.ts
  - packages/semantic-core/src/__tests__/benchmarking.integration.test.ts
  - packages/semantic-core/src/index.ts (update)
  - apps/api/migrations/020_add_workspace_benchmarking.sql
  - apps/api/src/routes/workspace-benchmarking.ts
  - apps/api/src/server.ts (update)
  - apps/api/src/__tests__/workspace-benchmarking.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation, Token Analytics Service & Dashboard
- **Added**: 2026-06-07

### Task: Benchmarking Dashboard Widget & Visualization
- **Layer**: 22 — API Wiring & Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build benchmarking dashboard widget at apps/dashboard/components/benchmarking-card.tsx showing: (1) current workspace metrics (token savings %, entity count, cache hit rate), (2) peer benchmark comparison with box plots or quartile visualization (e.g., "your token savings: 62%, peer median: 55%"), (3) percentile rank badge (e.g., "top 15% for compression"), (4) opt-in toggle for data sharing with explanatory tooltip. Integrate into dashboard overview page (apps/dashboard/app/page.tsx) in a dedicated section. Add E2E test verifying: widget loads metrics via GET /api/v1/workspace/benchmark-snapshot, renders comparison chart, opt-in toggle persists via API. Use Recharts or similar for visualization. Reference dashboard component patterns for consistent styling.
- **Files**:
  - apps/dashboard/components/benchmarking-card.tsx
  - apps/dashboard/app/page.tsx (update)
  - apps/dashboard/components/benchmark-comparison-chart.tsx
  - apps/dashboard/__tests__/benchmarking-card.test.tsx
  - tests/e2e/benchmarking-widget.spec.ts
- **Depends on**: Benchmarking Service Implementation & API
- **Added**: 2026-06-07

---

## Layer 23: E2E Integration & Testing

### Task: Multi-Tenant Isolation E2E Test Suite
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Write comprehensive end-to-end tests in tests/e2e/ to verify strict workspace isolation across all APIs and data flows. Tests should: (1) create two separate workspaces with their own connectors and indexed entities, (2) authenticate as one workspace and attempt to access resources from the other (should get 403), (3) verify MCP server reject cross-workspace queries, (4) verify REST API connectors/:id endpoint returns 403 when queried from wrong workspace, (5) verify entity search filters by workspace_id. Add 8–10 Playwright test cases covering API + MCP layer. Reference api-conventions.md for auth patterns and testing.md for test organization.
- **Files**:
  - tests/e2e/multi-tenant-isolation.spec.ts
  - tests/e2e/utils/test-setup.ts (update with multi-workspace helpers)
- **Depends on**: Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

### Task: Webhook Delivery & Retry Queue Implementation
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a webhook delivery system with automatic retries for failed webhook events. Create packages/queue/src/webhook-queue.ts with WebhookQueue class managing delivery attempts (BullMQ job queue). Methods: enqueueWebhook(event), processDelivery(job) with exponential backoff (max 5 retries, base 2s delay). Track delivery status in webhooks_events table (id, workspace_id, event_type, payload, status, attempt_count, nextRetryAt, completedAt). Expose GET /api/v1/webhooks/events endpoint with filtering/pagination. Build dashboard component at apps/dashboard/components/webhook-delivery-status.tsx showing delivery queues and retry logs. Full integration tests with real BullMQ queue. Reference api-conventions.md for REST patterns.
- **Files**:
  - packages/queue/src/webhook-queue.ts
  - packages/queue/src/__tests__/webhook-queue.integration.test.ts
  - apps/api/migrations/021_add_webhook_events.sql
  - apps/api/src/routes/webhooks.ts (update)
  - apps/dashboard/components/webhook-delivery-status.tsx
  - apps/api/src/__tests__/webhooks.test.ts (update)
- **Depends on**: Webhook-Driven Real-Time Sync
- **Added**: 2026-06-07

### Task: PII Masking Enforcement E2E Tests
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Write end-to-end tests to verify PII masking is correctly applied in MCP and REST API responses. Tests should: (1) index entities with PII fields (email, SSN, phone), (2) configure masking rules (redaction, hashing, tokenization), (3) query context via MCP and verify PII fields are masked in response, (4) verify unmasked fields still appear, (5) test role-based PII filtering (some roles see email, others don't), (6) verify audit logs record which fields were masked and by whom. Add 6–8 Playwright test cases covering integration with query-context tool and REST API. Reference pii-masker.ts and role-based-context-segmentation.md for masking patterns.
- **Files**:
  - tests/e2e/pii-masking.spec.ts
  - tests/e2e/fixtures/pii-test-entities.json
- **Depends on**: Fine-Grained PII & Sensitive Field Masking, Role-Based Context Segmentation
- **Added**: 2026-06-07

### Task: Workspace Settings Page & Team Management UI
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a complete workspace settings page at apps/dashboard/app/settings/[workspaceId]/page.tsx with tabs for: (1) Basic info (workspace name, owner, created date, edit form), (2) Team members (list current users/API keys, invite new members via email, revoke access), (3) API Keys (list MCP API keys, create new, view scopes, revoke), (4) Billing (show plan, usage metrics, upgrade button), (5) Data & Privacy (export data, delete workspace, PII config quick link). Create supporting components: WorkspaceInfo, TeamMemberList, TeamInviteForm, ApiKeyManager, BillingCard. Wire to GET/PUT /api/v1/workspace/settings endpoints and team management endpoints (not yet created — scope for next layer if needed). Add Playwright E2E test verifying full settings flow. Reference dashboard component patterns for UI consistency.
- **Files**:
  - apps/dashboard/app/settings/[workspaceId]/page.tsx
  - apps/dashboard/components/workspace-info.tsx
  - apps/dashboard/components/team-member-list.tsx
  - apps/dashboard/components/team-invite-form.tsx
  - apps/dashboard/components/api-key-manager.tsx
  - apps/dashboard/components/billing-card.tsx
  - apps/dashboard/app/settings/[workspaceId]/__tests__/page.test.tsx
  - tests/e2e/settings-management.spec.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

### Task: Analytics Drill-Down & Per-Connector Token Usage
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend analytics dashboard with drill-down views showing per-connector token consumption breakdown. Create apps/dashboard/app/analytics/[workspaceId]/breakdown/page.tsx with: (1) entity type breakdown (tokens by contact vs company vs deal, etc), (2) per-connector breakdown (HubSpot vs Notion vs Slack token usage), (3) time-series granularity (hourly, daily, weekly, monthly). Implement API endpoint GET /api/v1/analytics/breakdown?granularity=daily&groupBy=connector returning time-series data. Create supporting components: TokenBreakdownChart (stacked bar chart via Recharts), FilterControls (time range, grouping options). Wire token_events table aggregation queries with proper indexing. Add integration tests verifying aggregations are correct. Reference token-analytics.ts and api-conventions.md patterns.
- **Files**:
  - apps/dashboard/app/analytics/[workspaceId]/breakdown/page.tsx
  - apps/dashboard/components/token-breakdown-chart.tsx
  - apps/dashboard/components/analytics-filter-controls.tsx
  - apps/api/src/routes/analytics.ts (update)
  - apps/api/src/__tests__/analytics.test.ts (update)
- **Depends on**: Token Analytics Service & Dashboard
- **Added**: 2026-06-07

### Task: Connector Health Drill-Down & Error Log Viewer
- **Layer**: 23 — E2E Integration & Testing
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a connector health detail page at apps/dashboard/app/connectors/[id]/health/page.tsx showing detailed diagnostic information: (1) current health status (green/yellow/red), (2) last sync attempt timestamp and duration, (3) error logs (if unhealthy) with stack traces, (4) retry queue status (pending, failed, completed), (5) historical sync success rate (last 30 days), (6) manual retry button. Implement backend: POST /api/v1/connectors/:id/health/retry endpoint to retry failed sync jobs. Create connector_sync_logs table (instance_id, sync_id, event_type, message, severity, timestamp) to track detailed sync lifecycle. Build supporting components: HealthStatusBadge, ErrorLogViewer, SyncHistoryChart, RetryButton. Add integration tests with mocked sync failures and retries. Reference connector-health-service.ts for health check patterns.
- **Files**:
  - apps/dashboard/app/connectors/[id]/health/page.tsx
  - apps/dashboard/components/health-status-badge.tsx
  - apps/dashboard/components/error-log-viewer.tsx
  - apps/dashboard/components/sync-history-chart.tsx
  - apps/api/migrations/022_add_connector_sync_logs.sql
  - apps/api/src/routes/connectors.ts (update)
  - apps/api/src/__tests__/connectors.test.ts (update)
- **Depends on**: Connector Health Monitoring & Dashboard Integration
- **Added**: 2026-06-07

---

## Layer 24: Production Readiness & Navigation

### Task: Health & Readiness Endpoints + Graceful Shutdown
- **Layer**: 24 — Production Readiness & Navigation
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement production-ready health checks and graceful shutdown across API and MCP servers. For apps/api/src/server.ts: add GET /health (returns 200 if services OK, 503 if DB/Redis down) and GET /ready endpoints with dependency status checks. For apps/mcp-server/src/server.ts: implement graceful shutdown handlers for SIGTERM/SIGINT that close DB/Redis connections cleanly, flush pending audit logs, and return 0. Add 30-second shutdown timeout. Update infra scripts to use these endpoints for Kubernetes liveness/readiness probes. Create integration tests verifying health checks detect DB/Redis failures and graceful shutdown completes within timeout. Reference code-style.md for error handling patterns.
- **Files**:
  - apps/api/src/health.ts
  - apps/api/src/server.ts (update)
  - apps/mcp-server/src/shutdown.ts
  - apps/mcp-server/src/server.ts (update)
  - apps/api/src/__tests__/health.integration.test.ts
  - apps/mcp-server/src/__tests__/shutdown.integration.test.ts
- **Depends on**: nothing
- **Added**: 2026-06-07

### Task: Dashboard Navigation & Breadcrumbs Layout Component
- **Layer**: 24 — Production Readiness & Navigation
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a reusable dashboard layout component and navigation system. Create apps/dashboard/components/dashboard-layout.tsx with: (1) fixed sidebar navigation showing all main sections (Overview, Connectors, Queries, Analytics, Graph, Workflows, Settings), (2) active route highlighting, (3) workspace selector dropdown, (4) breadcrumb trail at top of content area. Create apps/dashboard/components/breadcrumbs.tsx to auto-generate breadcrumbs from route segments (e.g., /connectors/[id]/health → Connectors > [name] > Health). Update the root layout.tsx to use DashboardLayout wrapper. Add responsive mobile sidebar toggle. Build with shadcn/ui components (NavigationMenu, DropdownMenu, Breadcrumb). Add test verifying navigation links match filesystem routes and breadcrumbs update on route change. Target: all dashboard pages inherit consistent nav/breadcrumb layout.
- **Files**:
  - apps/dashboard/components/dashboard-layout.tsx
  - apps/dashboard/components/breadcrumbs.tsx
  - apps/dashboard/app/layout.tsx (update)
  - apps/dashboard/components/__tests__/dashboard-layout.test.tsx
- **Depends on**: nothing
- **Added**: 2026-06-07

### Task: OpenAPI/Swagger API Documentation
- **Layer**: 24 — Production Readiness & Navigation
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Generate and serve OpenAPI 3.0 documentation for the REST API. Add @hono/swagger middleware to apps/api/src/server.ts to auto-generate OpenAPI schema from route handlers and zod schemas. Create GET /docs endpoint serving Swagger UI. Manually document all 15+ routes with descriptions, parameters, request/response examples. Ensure all zod schemas have descriptions (.describe('...')). Build a separate GET /openapi.json endpoint for spec download. Add security scheme documentation (Clerk JWT auth). Create a simple docs page at apps/dashboard/docs/api.tsx linking to /docs. Add integration test verifying OpenAPI schema is valid and all routes are documented. Reference api-conventions.md for request/response envelope format.
- **Files**:
  - apps/api/src/openapi.ts
  - apps/api/src/server.ts (update)
  - apps/api/src/__tests__/openapi.test.ts
  - apps/dashboard/app/docs/page.tsx
- **Depends on**: API Server Bootstrap
- **Added**: 2026-06-07

### Task: MCP Tool Streaming & Pagination Support
- **Layer**: 24 — Production Readiness & Navigation
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance MCP tools to support streaming large result sets via pagination. Update apps/mcp-server/src/tools/list-entities.ts and list-glossary.ts to: (1) accept optional `cursor` parameter for pagination, (2) return `{ content: [...], nextCursor?: string }` instead of flat arrays, (3) enforce max 100 results per page. Implement cursor-based pagination using entity IDs and timestamps (compatible with existing audit log pagination pattern). Add tests verifying pagination works across multiple pages and cursor validation. Update documentation in tool descriptions. This enables MCP clients to efficiently retrieve large datasets (10K+ entities) without hitting token budgets. Reference semantic-core pagination patterns (audit.ts) for cursor encoding format.
- **Files**:
  - apps/mcp-server/src/tools/list-entities.ts (update)
  - apps/mcp-server/src/tools/list-glossary.ts (update)
  - apps/mcp-server/src/__tests__/server.integration.test.ts (update)
- **Depends on**: MCP Server Bootstrap
- **Added**: 2026-06-07

### Task: Dashboard Component Test Suite & Coverage
- **Layer**: 24 — Production Readiness & Navigation
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Increase dashboard test coverage to 50%+ by adding unit tests for high-value components. Write test files in apps/dashboard/components/__tests__/ for: (1) ConnectorCard (renders health status, sync time, actions), (2) BenchmarkingCard (displays peer comparison box plot, opt-in toggle), (3) WorkflowTemplateGallery (lists templates, open/edit/delete actions), (4) PiiConfigPanel (PII field detection, masking strategy selection). Use vitest + React Testing Library. Mock API responses with MSW. Each component should have 8+ test cases covering happy path, error states, empty states, and edge cases. Target: 20+ new tests. Ensure all tests pass and validate rendered output against Recharts/shadcn/ui patterns. Reference testing.md for test organization and snapshot usage rules.
- **Files**:
  - apps/dashboard/components/__tests__/connector-card.test.tsx
  - apps/dashboard/components/__tests__/benchmarking-card.test.tsx
  - apps/dashboard/components/__tests__/workflow-template-gallery.test.tsx
  - apps/dashboard/components/__tests__/pii-config-panel.test.tsx
- **Depends on**: Dashboard Scaffold
- **Added**: 2026-06-07

---

## Layer 25: Production Stability & Testing

### Task: Advanced Rate Limiting & Quota Management
- **Layer**: 25 — Production Stability & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend rate limiting to support per-endpoint quotas and burst allowances. Create apps/api/src/middleware/quota-manager.ts to track API usage per workspace across different quota dimensions: (1) sync triggers (10/min default, configurable), (2) webhook events (100/min default), (3) MCP server connections (5 concurrent default). Implement quota allocation with burst capacity (e.g., allow 15 requests if quota is 10/min but idle for 5 min). Store quota state in Redis with TTL. Return 429 with X-RateLimit-* headers showing remaining quota and reset time. Add integration tests verifying quota enforcement, burst logic, and concurrent request handling. Reference api-conventions.md for HTTP status codes and rate-limiter patterns.
- **Files**:
  - apps/api/src/middleware/quota-manager.ts
  - apps/api/src/__tests__/quota-manager.integration.test.ts
  - apps/api/src/server.ts (update)
- **Depends on**: REST API Rate Limiting & Request Throttling
- **Added**: 2026-06-07

### Task: Semantic Cache Coherence & Invalidation E2E Test Suite
- **Layer**: 25 — Production Stability & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build comprehensive E2E tests in tests/e2e/ verifying cache coherence when indexed entities change. Tests should: (1) index a set of entities and verify query result is cached, (2) sync a connector and update one entity, verify cache is invalidated for affected queries, (3) test relationship expansion caching (expand entity A -> entity B -> entity C, then update B, verify only B/C cache invalidated, A cache untouched), (4) test multi-connector sync with cross-connector relationships, verify cascading invalidation, (5) verify semantic response cache hits for semantically equivalent queries (cosine similarity > 0.92). Add 10+ Playwright test cases with timing assertions (cached: <100ms, miss: >1s). Reference semantic-cache.ts and cache-patterns in code-style.md.
- **Files**:
  - tests/e2e/cache-coherence.spec.ts
  - tests/e2e/fixtures/cache-test-entities.json
- **Depends on**: Semantic Cache, Entity Relationship Indexing
- **Added**: 2026-06-07

### Task: Dashboard Component Test Suite Completion
- **Layer**: 25 — Production Stability & Testing
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Complete the Dashboard Component Test Suite from Layer 24 by adding comprehensive unit tests for remaining high-value components. Write test files in apps/dashboard/components/__tests__/ for: (1) ErrorLogViewer (renders error messages, pagination, filtering), (2) TokenBreakdownChart (renders Recharts stacked bar chart, time-series aggregation), (3) ApiKeyManager (list, create, revoke with confirmations), (4) HealthStatusBadge (color coding, tooltip, refresh indicator). Use vitest + React Testing Library + MSW for API mocking. Target 8+ test cases per component covering: happy paths, error states, empty states, loading states, user interactions (clicks, form input), and edge cases (long text, special characters, very large datasets). Ensure snapshot tests are minimal and reviewed. Achieve 50%+ coverage for dashboard/components. All tests should pass.
- **Files**:
  - apps/dashboard/components/__tests__/error-log-viewer.test.tsx
  - apps/dashboard/components/__tests__/token-breakdown-chart.test.tsx
  - apps/dashboard/components/__tests__/api-key-manager.test.tsx
  - apps/dashboard/components/__tests__/health-status-badge.test.tsx
- **Depends on**: Dashboard Scaffold
- **Added**: 2026-06-07

### Task: Custom Connector Framework & User-Extensible SDK
- **Layer**: 25 — Production Stability & Testing
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable business users and developers to build custom connectors without modifying core code. Create packages/connector-sdk/src/user-connector-loader.ts with loadUserConnector(path) that dynamically imports a connector from a user-provided directory. Define a simplified ConnectorManifest schema that users can extend (e.g., CustomConnector = { name, description, auth, entityTypes, sync() }). Add validation to ensure custom connectors implement required methods and follow entity transformation rules. Create apps/api/src/routes/custom-connectors.ts with: POST /api/v1/custom-connectors/upload (multipart form with zip file), POST /api/v1/custom-connectors/validate (validate before installation), GET /api/v1/custom-connectors (list installed custom connectors). Store uploaded connector code in a safe sandbox directory with isolation guarantees. Add comprehensive tests: (1) valid connector upload/validation, (2) missing method detection, (3) entity schema validation, (4) connector instantiation and sync execution. Reference connector-patterns.md for entity requirements.
- **Files**:
  - packages/connector-sdk/src/user-connector-loader.ts
  - packages/connector-sdk/src/__tests__/user-connector-loader.test.ts
  - apps/api/src/routes/custom-connectors.ts
  - apps/api/migrations/023_add_custom_connectors.sql
  - apps/api/src/__tests__/custom-connectors.test.ts
- **Depends on**: Connector Registry, Connector Instance Management API
- **Added**: 2026-06-07

### Task: Observability & Distributed Tracing Infrastructure
- **Layer**: 25 — Production Stability & Testing
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Add OpenTelemetry tracing across API, MCP server, and worker processes for production observability. Create apps/api/src/telemetry.ts and apps/mcp-server/src/telemetry.ts to: (1) initialize OpenTelemetry SDK with OTLP exporter (Jaeger/Datadog compatible), (2) instrument HTTP servers (Hono middleware), (3) instrument database queries (postgres pool wrapper), (4) instrument Redis operations (ioredis instrumentation), (5) create custom spans for critical operations (connector sync, entity indexing, cache lookups). Include trace context propagation for request tracing across services. Add environment variables for OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME. Update docker-compose.yml to include a local Jaeger service for dev. Create integration tests verifying traces are exported and include expected span attributes. Reference code-style.md for logging patterns and ensure structured metadata includes trace IDs.
- **Files**:
  - apps/api/src/telemetry.ts
  - apps/mcp-server/src/telemetry.ts
  - apps/api/src/server.ts (update)
  - apps/mcp-server/src/server.ts (update)
  - infra/docker/docker-compose.yml (add Jaeger service)
  - apps/api/src/__tests__/telemetry.integration.test.ts
  - apps/mcp-server/src/__tests__/telemetry.test.ts
- **Depends on**: Health & Readiness Endpoints + Graceful Shutdown
- **Added**: 2026-06-07

---

## Layer 26: Production Operations & Advanced Features

### Task: Sync Job Error Recovery & Dead Letter Queue
- **Layer**: 26 — Production Operations & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement robust error recovery for failed connector syncs with a dead letter queue (DLQ) system. Extend packages/queue/src/sync-job-queue.ts to: (1) capture detailed error context when a sync fails (error message, stack trace, entity batch that failed), (2) after 3 retries with exponential backoff (1s, 10s, 60s), move the job to a DLQ table in Postgres (deadletter_jobs with job_id, connector_instance_id, error, failedBatch, createdAt), (3) expose GET /api/v1/admin/dlq endpoint to list failed jobs with error details, (4) implement POST /api/v1/admin/dlq/:jobId/retry to manually replay a failed job, optionally with a subset of the batch. Build dashboard admin panel at apps/dashboard/app/admin/dlq/page.tsx showing DLQ entries with filters (connector, date range, error type), error messages, and retry actions. Add integration tests verifying: job retry exhaustion triggers DLQ write, manual replay works, error context is preserved. Reference code-style.md for error handling patterns and api-conventions.md for REST conventions.
- **Files**:
  - packages/queue/src/sync-job-queue.ts (update)
  - apps/api/migrations/024_add_deadletter_queue.sql
  - apps/api/src/routes/admin-dlq.ts
  - apps/dashboard/app/admin/dlq/page.tsx
  - apps/dashboard/components/dlq-inspector.tsx
  - packages/queue/src/__tests__/sync-job-queue.test.ts (update)
  - apps/api/src/__tests__/admin-dlq.test.ts
- **Depends on**: BullMQ Job Queue Infrastructure, Sync Worker Implementation & Connector Invocation
- **Added**: 2026-06-07

### Task: Advanced Entity Deduplication & Fuzzy Matching
- **Layer**: 26 — Production Operations & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement sophisticated cross-connector entity matching to unify duplicate data from multiple sources (e.g., same contact appears in HubSpot and Salesforce under slightly different names/emails). Create packages/semantic-core/src/entity-deduplication.ts with EntityDuplicateMatcher class: (1) build a similarity matrix for entities using multiple signals (name Levenshtein distance, email domain match, phone number match, semantic embedding cosine similarity), (2) apply fuzzy matching rules (e.g., if name_similarity > 0.8 AND email_domain_match, link entities), (3) create canonical_entity_links table mapping duplicate entity IDs to a canonical entity ID, (4) update retrieval engine to return canonical entities and suppress duplicates. Expose POST /api/v1/admin/dedup/analyze to scan for duplicates and return recommendations, and POST /api/v1/admin/dedup/merge/:canonicalId/:duplicateId to merge two entities. Add admin dashboard page at apps/dashboard/app/admin/dedup/page.tsx with duplicate pair inspector and merge workflows. Include unit tests with synthetic duplicate datasets (100 entity pairs with varied similarity profiles) and integration tests. Reference embedding-patterns.md for similarity threshold tuning.
- **Files**:
  - packages/semantic-core/src/entity-deduplication.ts
  - packages/semantic-core/src/__tests__/entity-deduplication.test.ts
  - packages/semantic-core/src/__tests__/entity-deduplication.integration.test.ts
  - apps/api/migrations/025_add_entity_deduplication.sql
  - apps/api/src/routes/admin-dedup.ts
  - apps/api/src/retrieval.ts (update)
  - apps/dashboard/app/admin/dedup/page.tsx
  - apps/dashboard/components/duplicate-inspector.tsx
  - apps/api/src/__tests__/admin-dedup.test.ts
- **Depends on**: Entity Relationship Indexing, Semantic Cache
- **Added**: 2026-06-07

### Task: Workspace Data Export & Backup Service
- **Layer**: 26 — Production Operations & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive data export and backup capabilities for workspace portability and disaster recovery. Create packages/semantic-core/src/data-exporter.ts with DataExporter class: (1) exportWorkspace(workspaceId, options) returning all entities, glossary, metrics, relationships, and configs as a structured JSON backup, (2) exportEntities(workspaceId, filters) returning entities filtered by type/date range/connector, (3) exportSchema(workspaceId) returning canonical schema definitions, (4) implement async export with progress tracking (store export jobs in exports_jobs table). Expose POST /api/v1/workspace/export/full (full backup), POST /api/v1/workspace/export/entities (filtered export), with streaming response for large exports. Add import capability: POST /api/v1/admin/workspace/import to restore a backup (requires admin permission and explicit workspace selection). Build admin UI at apps/dashboard/app/admin/backup/page.tsx with: export trigger, progress indicator, download link, scheduled daily exports toggle. Add unit tests with synthetic workspace fixtures and integration tests verifying round-trip export/import preserves all data. See api-conventions.md for response envelope patterns.
- **Files**:
  - packages/semantic-core/src/data-exporter.ts
  - packages/semantic-core/src/__tests__/data-exporter.test.ts
  - packages/semantic-core/src/__tests__/data-exporter.integration.test.ts
  - apps/api/migrations/026_add_export_jobs.sql
  - apps/api/src/routes/admin-backup.ts
  - apps/api/src/routes/workspace-export.ts
  - apps/dashboard/app/admin/backup/page.tsx
  - apps/dashboard/components/backup-manager.tsx
  - apps/api/src/__tests__/admin-backup.test.ts
  - apps/api/src/__tests__/workspace-export.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation, Glossary Service & API, Metric Registry Service & API
- **Added**: 2026-06-07

### Task: Connector Sync Performance Profiling & Analytics
- **Layer**: 26 — Production Operations & Advanced Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Add detailed performance instrumentation to connector syncs to identify bottlenecks and optimize behavior. Extend packages/queue/src/sync-job-queue.ts to record: (1) sync duration (total, API time, indexing time, embedding time), (2) entity throughput (entities/sec), (3) API call counts and latency distribution, (4) error rates by type, (5) memory usage peak. Store metrics in sync_performance table (job_id, connector_id, total_duration_ms, api_calls, entities_synced, avg_entity_size_bytes, peak_memory_mb, error_count, timestamp). Expose GET /api/v1/admin/performance/connectors/:id returning historical performance metrics with aggregations (daily avg, trend line). Build dashboard page at apps/dashboard/app/admin/performance/page.tsx with: line chart of throughput over time per connector, heatmap of daily sync duration, percentile distribution tables (p50, p90, p99 sync duration). Add alerts: warn if sync duration increases >50% vs 7-day avg. Include integration tests with synthetic sync job fixtures. Reference code-style.md for logging and structured metadata patterns.
- **Files**:
  - apps/api/migrations/027_add_sync_performance.sql
  - packages/queue/src/sync-job-queue.ts (update)
  - apps/api/src/routes/admin-performance.ts
  - apps/dashboard/app/admin/performance/page.tsx
  - apps/dashboard/components/performance-charts.tsx
  - packages/queue/src/__tests__/sync-job-queue.test.ts (update)
  - apps/api/src/__tests__/admin-performance.test.ts
- **Depends on**: BullMQ Job Queue Infrastructure, Token Analytics Service & Dashboard
- **Added**: 2026-06-07

### Task: Admin Console & Workspace Inspection Tools
- **Layer**: 26 — Production Operations & Advanced Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a comprehensive admin console dashboard for ops teams to inspect and manage workspace health. Create apps/dashboard/app/admin/page.tsx (main console) with tabs: (1) Workspace Overview (list all workspaces, entity counts, last sync times, MCP query volume), (2) System Health (database connection status, Redis latency, Qdrant health, disk usage), (3) Performance Dashboard (sync throughput, query latency p50/p95/p99, cache hit rate trend), (4) Error Analysis (error log with filtering/search, error frequency heatmap by error type, correlation analysis), (5) Config Inspector (view/edit workspace settings, NLP configs, PII rules, rate limit overrides). Build supporting components: WorkspaceInspector, SystemHealthMonitor, PerformanceDashboard, ErrorLogViewer, ConfigPanel. Wire up to new admin API endpoints: GET /api/v1/admin/workspaces, GET /api/v1/admin/system-health, GET /api/v1/admin/errors (with filters: workspace, date range, error type). Require admin role (Clerk organization admin) for all endpoints. Add E2E test verifying admin can view all workspaces but cannot modify other workspace data. Reference dashboard component patterns and api-conventions.md for auth/response envelope.
- **Files**:
  - apps/dashboard/app/admin/page.tsx
  - apps/dashboard/components/admin-workspace-overview.tsx
  - apps/dashboard/components/system-health-monitor.tsx
  - apps/dashboard/components/performance-dashboard.tsx
  - apps/dashboard/components/error-log-viewer.tsx
  - apps/dashboard/components/config-inspector.tsx
  - apps/api/src/routes/admin-console.ts
  - apps/api/src/middleware/admin-auth.ts
  - apps/api/src/__tests__/admin-console.test.ts
  - tests/e2e/admin-console.spec.ts
- **Depends on**: Health & Readiness Endpoints + Graceful Shutdown, Token Analytics Service & Dashboard
- **Added**: 2026-06-07

---

## Layer 27: Advanced Operations & Post-MVP Polish

### Task: Team Management & Workspace Provisioning API
- **Layer**: 27 — Advanced Operations & Post-MVP Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive team and workspace management APIs to enable multi-user collaboration and workspace administration. Create apps/api/migrations/028_add_team_management.sql with tables: workspace_members (workspace_id, user_id, email, role: 'admin'|'member'|'viewer', inviteStatus, joinedAt), team_invitations (id, workspace_id, email, invitedBy, expiresAt, token). Create apps/api/src/routes/team-management.ts with endpoints: POST /api/v1/workspace/members/invite (invite new users, send email via SendGrid), GET /api/v1/workspace/members (list members and invitations), PUT /api/v1/workspace/members/:userId/role (change member role), DELETE /api/v1/workspace/members/:userId (remove member). Implement email notification service in packages/core/src/email-service.ts using SendGrid SDK. Validate invitations via secure tokens (JWT with 7-day expiry). Update auth middleware to enforce workspace membership checks. Add 20+ unit tests for role-based access control, invite token validation, and email sending. Add integration tests with mocked SendGrid. Reference api-conventions.md and code-style.md.
- **Files**:
  - apps/api/migrations/028_add_team_management.sql
  - apps/api/src/routes/team-management.ts
  - packages/core/src/email-service.ts
  - apps/api/src/middleware/workspace-membership.ts
  - apps/api/src/__tests__/team-management.test.ts
  - packages/core/src/__tests__/email-service.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

### Task: Workspace Deletion & Data Retention Policies
- **Layer**: 27 — Advanced Operations & Post-MVP Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement safe workspace deletion with configurable data retention and compliance options. Create apps/api/migrations/029_add_deletion_policies.sql with workspace_deletion_policies table (workspace_id, retentionDays, backupBeforeDeletion, legalHold). Implement WorkspaceDeletionService in packages/semantic-core/src/workspace-deletion.ts with: (1) requestDeletion(workspaceId, reason) marking workspace for 30-day soft deletion (grace period for accidental deletes), (2) exportBeforeDeletion(workspaceId) triggering automatic backup export, (3) cancelDeletion(workspaceId) reverting the soft delete, (4) permanentlyDelete(workspaceId) hard-deleting all workspace data (cascade delete from all tables via SQL triggers). Create POST /api/v1/workspace/deletion/request endpoint (requires admin role + 2FA verification), PUT /api/v1/workspace/deletion/cancel (within grace period), and GET /api/v1/workspace/deletion/status. Build dashboard warning UI at apps/dashboard/app/settings/[workspaceId]/deletion/page.tsx with 30-day countdown, backup status, and cancel button. Add comprehensive audit logging for all deletion operations. Write 15+ tests covering edge cases: deletion during active syncs, cross-workspace data isolation during deletion, cascade delete verification. Reference code-style.md error handling.
- **Files**:
  - apps/api/migrations/029_add_deletion_policies.sql
  - packages/semantic-core/src/workspace-deletion.ts
  - packages/semantic-core/src/__tests__/workspace-deletion.test.ts
  - packages/semantic-core/src/__tests__/workspace-deletion.integration.test.ts
  - apps/api/src/routes/workspace-deletion.ts
  - apps/dashboard/app/settings/[workspaceId]/deletion/page.tsx
  - apps/api/src/__tests__/workspace-deletion.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation, Workspace Data Export & Backup Service
- **Added**: 2026-06-07

### Task: Alert Rules Engine & Notification Channels
- **Layer**: 27 — Advanced Operations & Post-MVP Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a flexible alert system allowing workspaces to define rules and receive notifications via multiple channels. Create apps/api/migrations/030_add_alerts.sql with tables: alert_rules (id, workspace_id, name, condition: 'sync_failure'|'token_quota'|'performance_degradation'|'cache_miss_rate', threshold, enabled, createdAt), alert_channels (id, workspace_id, type: 'email'|'slack'|'pagerduty'|'webhook', config: {...}, isDefault), alert_events (id, workspace_id, rule_id, channel_id, status: 'triggered'|'delivered'|'failed', sentAt). Implement AlertsService in packages/semantic-core/src/alerts.ts with: (1) evaluateRules(workspaceId) scanning recent metrics against all active rules, (2) sendAlert(alert, channels) dispatching to configured channels (email via SendGrid, Slack via webhooks, PagerDuty via API), (3) manageRules CRUD. Create apps/api/src/routes/alerts.ts with: GET /api/v1/workspace/alerts/rules, POST /api/v1/workspace/alerts/rules, DELETE /api/v1/workspace/alerts/rules/:id. Build dashboard config page at apps/dashboard/app/settings/[workspaceId]/alerts/page.tsx with rule editor (select condition + threshold), channel manager, and test alert button. Add integration tests with mocked Slack/PagerDuty APIs. Reference api-conventions.md and embedding-patterns.md for cost control (alert evaluation should be lightweight).
- **Files**:
  - apps/api/migrations/030_add_alerts.sql
  - packages/semantic-core/src/alerts.ts
  - packages/semantic-core/src/__tests__/alerts.test.ts
  - apps/api/src/routes/alerts.ts
  - apps/dashboard/app/settings/[workspaceId]/alerts/page.tsx
  - apps/dashboard/components/alert-rule-editor.tsx
  - apps/dashboard/components/alert-channel-manager.tsx
  - apps/api/src/__tests__/alerts.test.ts
- **Depends on**: Token Analytics Service & Dashboard, Observability & Distributed Tracing Infrastructure
- **Added**: 2026-06-07

### Task: Workspace Onboarding Flow & First-Sync Guided Experience
- **Layer**: 27 — Advanced Operations & Post-MVP Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a comprehensive guided onboarding flow for new workspaces to accelerate time-to-value. Create apps/dashboard/app/onboarding/page.tsx with a multi-step wizard: (1) Workspace Setup (name, industry, company size, use case), (2) Connector Selection (pick 1-3 primary connectors from recommended list based on industry/use case), (3) Guided Connector Setup (walk through OAuth/API key per selected connector with explanatory text and example screenshots), (4) Schema Confirmation (auto-discover schemas and let user confirm/customize entity type mappings), (5) Glossary Kickstart (auto-populate glossary with industry templates: finance → ARR, MRR, CAC; sales → pipeline_stage, win_rate), (6) First Sync (trigger a sync, show progress with estimated entity counts), (7) Success (show index overview, suggest MCP integration docs). Use shadcn/ui Stepper component. Store completion state in workspace_onboarding table (workspace_id, completedSteps[], status: 'in_progress'|'completed'). Add branching logic: skip connectors if already configured, offer sample data if real connectors unavailable. Create E2E test covering full flow. Reference connector-patterns.md for connector setup and embedding-patterns.md for glossary templates. Target: onboarding completion < 10 minutes.
- **Files**:
  - apps/dashboard/app/onboarding/page.tsx
  - apps/dashboard/components/onboarding-wizard.tsx
  - apps/dashboard/components/onboarding-connector-selector.tsx
  - apps/dashboard/components/onboarding-glossary-kickstart.tsx
  - apps/dashboard/components/onboarding-progress.tsx
  - apps/api/migrations/031_add_workspace_onboarding.sql
  - apps/api/src/routes/onboarding.ts
  - tests/e2e/onboarding-flow.spec.ts
  - apps/api/src/__tests__/onboarding.test.ts
- **Depends on**: Connector Setup UI Flow, Glossary Service & API
- **Added**: 2026-06-07

### Task: Advanced Query Performance Analytics & Vector Index Optimization
- **Layer**: 27 — Advanced Operations & Post-MVP Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Add detailed query performance analytics and automatic vector index optimization recommendations. Create packages/semantic-core/src/query-performance-analyzer.ts with: (1) logQueryMetrics(query, executionTime, embeddingTime, vectorSearchTime, graphExpansionTime, compressionTime, resultSize) storing to query_performance table (workspace_id, query_hash, metrics_json, timestamp), (2) analyzeQueryPatterns(workspaceId) identifying slow queries (p95 > 1s), identifying hot entities (queried frequently), recommending index improvements, (3) optimizeVectorIndex(workspaceId) suggesting: partial indexing for large datasets, entity bloom filters, approximate nearest neighbor tuning. Expose GET /api/v1/admin/analytics/queries/slow returning top 10 slow queries with execution breakdowns, GET /api/v1/admin/analytics/queries/patterns returning entity access heatmap. Build dashboard page at apps/dashboard/app/admin/query-analytics/page.tsx with: slow query explorer (sortable table showing query, p50/p95 latency, error rate), entity access heatmap (color-coded entity frequency grid), index optimization recommendations (clickable cards with implementation guide). Add 12+ unit tests with synthetic query trace fixtures. Reference code-style.md for logging patterns and embedding-patterns.md for cost budgeting.
- **Files**:
  - packages/semantic-core/src/query-performance-analyzer.ts
  - packages/semantic-core/src/__tests__/query-performance-analyzer.test.ts
  - apps/api/migrations/032_add_query_performance.sql
  - apps/api/src/routes/admin-query-analytics.ts
  - apps/dashboard/app/admin/query-analytics/page.tsx
  - apps/dashboard/components/slow-query-explorer.tsx
  - apps/dashboard/components/entity-access-heatmap.tsx
  - apps/api/src/__tests__/admin-query-analytics.test.ts
- **Depends on**: Advanced Index Optimization & Query Performance
- **Added**: 2026-06-07

---

## Layer 28: Cross-Connector Integration & Advanced Features

### Task: Cross-Connector Entity Linking & Data Enrichment
- **Layer**: 28 — Cross-Connector Integration & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement intelligent entity linking across connectors to unify duplicated data from multiple sources. Create packages/semantic-core/src/entity-linker.ts with EntityLinker service: (1) analyzeEntityConnections(workspaceId, entityType) scanning for potential duplicates across connectors using fuzzy matching (name similarity, email domain, phone prefix), (2) proposeLinks(entity1, entity2, confidence) returning confidence scores (0–1), (3) createLink(entity1, entity2, metadata) persisting canonical links in entity_cross_connector_links table. Expose POST /api/v1/admin/entity-linking/analyze (trigger analysis job) and POST /api/v1/admin/entity-linking/links endpoints. Update retrieval engine to follow links and enrich entities with data from linked records (e.g., HubSpot contact enriched with Slack user profile data). Build dashboard UI at apps/dashboard/components/entity-link-explorer.tsx showing graph of linked entities with confidence scores and merge suggestions. Include 20+ unit tests with synthetic cross-connector datasets and integration tests with real Postgres. Reference entity-deduplication.ts and embedding-patterns.md for similarity thresholds.
- **Files**:
  - packages/semantic-core/src/entity-linker.ts
  - packages/semantic-core/src/__tests__/entity-linker.test.ts
  - packages/semantic-core/src/__tests__/entity-linker.integration.test.ts
  - apps/api/migrations/033_add_entity_cross_connector_links.sql
  - apps/api/src/routes/entity-linking.ts
  - apps/dashboard/components/entity-link-explorer.tsx
  - apps/api/src/__tests__/entity-linking.test.ts
- **Depends on**: Advanced Entity Deduplication & Fuzzy Matching, Entity Relationship Indexing
- **Added**: 2026-06-07

### Task: Advanced MCP Query Features & Aggregations
- **Layer**: 28 — Cross-Connector Integration & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend MCP query tool to support advanced filtering, aggregations, and multi-step queries. Create packages/semantic-core/src/advanced-query-engine.ts with: (1) parseAdvancedQuery(queryString) supporting filter syntax (e.g., "contacts where industry='SaaS' and ARR>100k"), (2) executeAggregation(query, groupBy, aggregate) returning counts, sums, averages (e.g., "sum revenue by region"), (3) chainQueries(queries) executing multi-step queries (first query finds accounts, second finds associated contacts). Add new MCP tool advanced-query-context accepting filter expressions and aggregation specs, returning aggregated results with confidence bounds. Update apps/mcp-server/src/server.ts to register the new tool. Add unit tests with 30+ filter/aggregation test cases, integration tests with real semantic index. Ensure responses respect contextBudget. Reference api-conventions.md for REST patterns and embedding-patterns.md for token budgeting.
- **Files**:
  - packages/semantic-core/src/advanced-query-engine.ts
  - packages/semantic-core/src/__tests__/advanced-query-engine.test.ts
  - packages/semantic-core/src/__tests__/advanced-query-engine.integration.test.ts
  - apps/mcp-server/src/tools/advanced-query-context.ts
  - apps/mcp-server/src/server.ts (update)
  - apps/mcp-server/src/__tests__/server.integration.test.ts (update)
- **Depends on**: MCP Server Bootstrap, Query Decomposition & Entity Type Detection
- **Added**: 2026-06-07

### Task: Comprehensive Webhook Validation & Testing Suite
- **Layer**: 28 — Cross-Connector Integration & Advanced Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a comprehensive testing framework for webhook implementations across all connectors. Create tests/webhook-validation/ with automated test suite that: (1) validates webhook payload schemas for each connector (HubSpot, Slack, etc.) against published specs, (2) tests HMAC signature validation (verify webhook origin is authentic), (3) verifies payload processing converts webhooks to entity deltas correctly, (4) tests rate limiting and retry logic (simulate webhook delivery failures), (5) tests workspace isolation (webhook from WS-A doesn't affect WS-B). Implement WebhookValidator class in packages/connector-sdk/src/webhook-validator.ts with: validatePayload(vendor, payload), validateSignature(payload, signature, secret), transformToEntityDelta(payload). Add E2E test suite in tests/e2e/webhook-validation.spec.ts with 15+ Playwright specs covering: webhook delivery, signature validation, entity creation/update/deletion via webhooks, retry scenarios. Create admin dashboard at apps/dashboard/components/webhook-validator.tsx to test webhook payloads interactively. Reference connector-patterns.md and testing.md for patterns.
- **Files**:
  - packages/connector-sdk/src/webhook-validator.ts
  - packages/connector-sdk/src/__tests__/webhook-validator.test.ts
  - tests/webhook-validation/hubspot-webhook.test.ts
  - tests/webhook-validation/slack-webhook.test.ts
  - tests/webhook-validation/common-patterns.test.ts
  - tests/e2e/webhook-validation.spec.ts
  - apps/dashboard/components/webhook-validator.tsx
- **Depends on**: Webhook-Driven Real-Time Sync, Connector Instance Management API
- **Added**: 2026-06-07

### Task: Real-Time Sync Performance Monitoring Dashboard
- **Layer**: 28 — Cross-Connector Integration & Advanced Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a live monitoring dashboard for real-time sync performance and health. Create apps/dashboard/app/admin/sync-monitoring/page.tsx with: (1) live sync queue status (in-flight jobs, pending queue depth, estimated completion time), (2) entity throughput gauge (entities/sec across all syncs), (3) per-connector live metrics (current sync progress, entities synced in this run, errors), (4) latency distribution chart (API response times, embedding time, indexing time), (5) error rate sparkline with drill-down to recent errors, (6) auto-refresh every 2 seconds via WebSocket or polling. Create WebSocket endpoint POST /api/v1/admin/sync-monitoring/subscribe (requires admin auth) streaming sync progress events. Extend packages/queue/src/sync-job-queue.ts to emit progress events (jobId, status, entitiesSynced, percentComplete). Build SyncMonitoringDashboard component using Socket.IO or Server-Sent Events. Add integration tests with mocked WebSocket connections. Reference code-style.md for logging patterns and embedding-patterns.md for cost awareness.
- **Files**:
  - apps/dashboard/app/admin/sync-monitoring/page.tsx
  - apps/dashboard/components/sync-monitoring-dashboard.tsx
  - apps/dashboard/components/sync-queue-status.tsx
  - apps/dashboard/components/entity-throughput-gauge.tsx
  - apps/api/src/routes/admin-sync-monitoring.ts
  - packages/queue/src/sync-job-queue.ts (update progress events)
  - apps/api/src/__tests__/admin-sync-monitoring.test.ts
- **Depends on**: BullMQ Job Queue Infrastructure, Connector Sync Performance Profiling & Analytics
- **Added**: 2026-06-07

### Task: Entity Change History & Audit Trail System
- **Layer**: 28 — Cross-Connector Integration & Advanced Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement comprehensive audit trails tracking entity changes for compliance and debugging. Create apps/api/migrations/034_add_entity_audit_trail.sql with entity_audit_events table (id, workspace_id, entity_id, change_type: 'created'|'updated'|'deleted', old_values_json, new_values_json, changed_by: 'connector_sync'|'webhook'|'user_import', source_connector_id, timestamp). Create packages/semantic-core/src/entity-audit-service.ts with: (1) trackChange(entity, changeType, source) recording entity changes, (2) getHistory(entityId, timeRange) returning change history, (3) getFieldHistory(entityId, fieldName) showing value timeline for specific fields, (4) detectAnomalies(workspaceId) identifying unusual change patterns (entity deleted and recreated rapidly, field values oscillating, bulk deletions). Expose GET /api/v1/entities/:id/audit-trail returning change history with pagination. Build dashboard page at apps/dashboard/app/entities/:id/audit-trail/page.tsx showing: timeline view of changes, before/after values, source connector, edit button for manual corrections. Add retention policy: keep 90-day history by default, configurable per workspace. Add 25+ unit tests covering all change types and integration tests with real Postgres. Reference code-style.md for error handling patterns.
- **Files**:
  - apps/api/migrations/034_add_entity_audit_trail.sql
  - packages/semantic-core/src/entity-audit-service.ts
  - packages/semantic-core/src/__tests__/entity-audit-service.test.ts
  - packages/semantic-core/src/__tests__/entity-audit-service.integration.test.ts
  - apps/api/src/routes/entity-audit.ts
  - apps/dashboard/app/entities/[id]/audit-trail/page.tsx
  - apps/dashboard/components/entity-audit-timeline.tsx
  - apps/api/src/__tests__/entity-audit.test.ts
- **Depends on**: Connector Sync Performance Profiling & Analytics, Observability & Distributed Tracing Infrastructure
- **Added**: 2026-06-07

---

## Layer 29: Email Integration & Outbound Messaging

### Task: SendGrid Email Integration Completion
- **Layer**: 29 — Email Integration & Outbound Messaging
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete the SendGrid email integration in packages/core/src/email-service.ts. Currently stubbed to log "stub — configure SendGrid" for email alerts. Implement full sendViaSendGrid(payload) method with proper API key handling, request retry logic (exponential backoff on 429/5xx), and comprehensive error handling returning Result<EmailSendResult, SendGridError>. Add integration tests with MSW mocking SendGrid v3 API responses. Wire up to alert notification dispatch in packages/semantic-core/src/alerts.ts so email channels actually deliver alert notifications. Reference code-style.md for error handling patterns.
- **Files**:
  - packages/core/src/email-service.ts (update)
  - packages/core/src/__tests__/email-service.integration.test.ts
  - packages/semantic-core/src/alerts.ts (update)
- **Depends on**: Alert Rules Engine (from completed tasks)
- **Added**: 2026-06-07

### Task: Email Template System & Customization
- **Layer**: 29 — Email Integration & Outbound Messaging
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a template system for email alerts to allow workspace admins to customize alert message formatting. Create packages/semantic-core/src/email-templates.ts with EmailTemplate interface (id, subject, htmlBody, textBody, variables). Implement email_templates and email_template_versions tables (migration 030) with upsert/get/list endpoints. Add /api/v1/email-templates CRUD routes. Build dashboard component at apps/dashboard/components/email-template-editor.tsx with live preview and variable interpolation. Integrate into alert dispatch pipeline so alerts use workspace's custom template if set, fallback to default. Full unit + integration tests with Handlebars-style template variable syntax.
- **Files**:
  - packages/semantic-core/src/email-templates.ts
  - packages/semantic-core/src/__tests__/email-templates.test.ts
  - apps/api/migrations/030_add_email_templates.sql
  - apps/api/src/routes/email-templates.ts
  - apps/dashboard/components/email-template-editor.tsx
  - packages/semantic-core/src/alerts.ts (update)
- **Depends on**: SendGrid Email Integration Completion
- **Added**: 2026-06-07

---

## Layer 30: Advanced Connector Features

### Task: Connector Incremental Sync Optimization & Change Data Capture
- **Layer**: 30 — Advanced Connector Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Enhance incremental sync strategy by implementing Change Data Capture (CDC) patterns for connectors. Create packages/semantic-core/src/connector-cdc.ts with ConnectorCDCManager class supporting three sync strategies: cursor-based (existing, for APIs with lastModified), event-driven (webhook or CDC logs), and snapshot-with-diff (comparing before/after snapshots). Add ChangeDataCaptureConfig to connector manifest allowing connectors to declare which strategy they support. Implement automatic strategy selection based on source API capabilities. Update sync-worker.ts to use CDC optimization reducing duplicate indexing. Add metrics tracking: entities_changed, entities_unchanged, sync_efficiency_ratio. Wire up to analytics dashboard. Full tests with mock connectors implementing each strategy.
- **Files**:
  - packages/semantic-core/src/connector-cdc.ts
  - packages/semantic-core/src/__tests__/connector-cdc.test.ts
  - apps/api/migrations/031_add_cdc_metrics.sql
  - apps/api/src/workers/sync-worker.ts (update)
  - packages/connector-sdk/src/base-connector.ts (update types)
- **Depends on**: Sync Worker Implementation & Connector Invocation
- **Added**: 2026-06-07

### Task: Connector Rate Limiting & Backoff Strategy Manager
- **Layer**: 30 — Advanced Connector Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement adaptive rate-limiting and backoff strategy for connectors to avoid API throttling. Create packages/queue/src/connector-rate-limiter.ts with RateLimiterManager supporting: (1) per-connector rate limit tracking (requests/sec, concurrent requests), (2) exponential backoff with jitter on 429 errors, (3) adaptive limits that tighten/loosen based on response headers (X-RateLimit-Remaining, Retry-After), (4) circuit breaker pattern (fail-fast if connector is degraded). Persist rate limit state to Redis with TTL. Update sync-worker.ts to consult rate limiter before invoking connector.sync(). Add unit tests with mocked Redis and integration tests with real Redis. Reference connector-patterns.md for rate limit handling rules.
- **Files**:
  - packages/queue/src/connector-rate-limiter.ts
  - packages/queue/src/__tests__/connector-rate-limiter.test.ts
  - apps/api/src/workers/sync-worker.ts (update)
- **Depends on**: BullMQ Job Queue Infrastructure
- **Added**: 2026-06-07

---

## Layer 31: Data Quality & Observability

### Task: Entity Data Quality Scoring & Validation
- **Layer**: 31 — Data Quality & Observability
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement data quality scoring for indexed entities to identify and flag low-quality or incomplete data. Create packages/semantic-core/src/data-quality-scorer.ts with DataQualityScorer class computing quality scores based on: (1) field completeness (% non-null attributes), (2) data freshness (days since last sync), (3) schema conformance (required fields present), (4) relationship validity (referenced entities exist), (5) duplicate likelihood (cosine similarity to related entities). Store scores in entity_quality_metrics table (entity_id, workspace_id, completeness_score, freshness_score, conformance_score, overall_quality_score, computed_at). Expose GET /api/v1/data-quality/report endpoint returning per-entity scores with filters. Build dashboard page apps/dashboard/app/data-quality/page.tsx showing quality distribution, issues list (low quality, stale, orphaned entities). Full unit + integration tests.
- **Files**:
  - packages/semantic-core/src/data-quality-scorer.ts
  - packages/semantic-core/src/__tests__/data-quality-scorer.test.ts
  - apps/api/migrations/032_add_entity_quality_metrics.sql
  - apps/api/src/routes/data-quality.ts
  - apps/dashboard/app/data-quality/page.tsx
  - apps/dashboard/components/quality-distribution-chart.tsx
- **Depends on**: Index Status & Coverage Metrics
- **Added**: 2026-06-07

### Task: Distributed Tracing Enhancements & Performance Profiling
- **Layer**: 31 — Data Quality & Observability
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the existing OpenTelemetry integration (already committed via previous feat commit) with enhanced spans for all critical paths: connector sync lifecycle, semantic indexing, vector search latency, cache operations. Add custom attributes to spans (workspace_id, entity_count, token_estimate). Implement PerformanceProfiler service in packages/semantic-core/src/performance-profiler.ts tracking p50/p95/p99 latencies per operation and per connector. Export metrics to Prometheus format. Add /metrics endpoint to apps/api and apps/mcp-server returning Prometheus metrics. Build performance dashboard at apps/dashboard/app/performance/page.tsx with latency charts, slowest operations ranking, per-connector breakdown. Full integration tests verifying spans are created and exported correctly. Reference code-style.md for logging patterns.
- **Files**:
  - packages/semantic-core/src/performance-profiler.ts
  - packages/semantic-core/src/__tests__/performance-profiler.test.ts
  - apps/api/src/middleware/telemetry.ts (update)
  - apps/mcp-server/src/telemetry.ts (update)
  - apps/dashboard/app/performance/page.tsx
  - apps/dashboard/components/performance-charts.tsx
  - apps/api/src/__tests__/metrics.test.ts
- **Depends on**: OpenTelemetry distributed tracing (from completed tasks)
- **Added**: 2026-06-07

---

## Layer 32: Compliance & Security Hardening

### Task: GDPR Data Subject Request Handler
- **Layer**: 32 — Compliance & Security Hardening
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a Data Subject Request (DSR) handler to support GDPR "right to access" and "right to erasure" requests. Create packages/semantic-core/src/dsr-handler.ts with DataSubjectRequestHandler class supporting: (1) finding all entities linked to a data subject (email, user ID, or PII identifier), (2) generating a portable export of the subject's data in JSON format, (3) scheduling PII deletion with audit trail. Add dsr_requests table (migration 035) tracking request_id, subject_identifier, request_type (access|erasure), status, created_at. Implement endpoints POST /api/v1/dsr/request, GET /api/v1/dsr/:requestId, DELETE /api/v1/dsr/:requestId/execute (after confirmation delay). Full audit logging of all DSR operations per user request. Unit + integration tests with GDPR-specific test data.
- **Files**:
  - packages/semantic-core/src/dsr-handler.ts
  - packages/semantic-core/src/__tests__/dsr-handler.test.ts
  - apps/api/migrations/035_add_dsr_requests.sql
  - apps/api/src/routes/dsr.ts
  - apps/api/src/__tests__/dsr.test.ts
- **Depends on**: Fine-Grained PII & Sensitive Field Masking
- **Added**: 2026-06-07

---

## Layer 33: Advanced Security & Compliance

### Task: Comprehensive Audit Trail & Log Viewer
- **Layer**: 33 — Advanced Security & Compliance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a comprehensive audit log system with searchable, filterable log viewer for compliance and debugging. Create apps/api/migrations/036_add_audit_logs.sql with audit_logs table: (workspace_id, actor_id, actor_type: 'user'|'api_key'|'system', action: 'entity_read'|'entity_write'|'config_change'|'permission_change', resource_type, resource_id, changes: JSON, ip_address, user_agent, timestamp). Implement AuditLogService in packages/semantic-core/src/audit-log-service.ts with methods: logAction(action, resource, metadata), queryLogs(workspaceId, filters), exportLogs(workspaceId, format: 'json'|'csv'). Add GET /api/v1/admin/audit-logs endpoint with cursor pagination and filtering by: action type, date range, actor, resource type. Build admin dashboard component at apps/dashboard/components/audit-log-viewer.tsx with: advanced filter UI, data export button, activity timeline visualization, anomaly highlighting (unusual access patterns). Ensure all sensitive operations (config changes, permission grants, DSR executions) are logged with full context. Add 25+ unit tests and integration tests verifying log completeness and tamper-evident storage. Reference code-style.md for structured logging patterns and api-conventions.md for REST design.
- **Files**:
  - packages/semantic-core/src/audit-log-service.ts
  - packages/semantic-core/src/__tests__/audit-log-service.test.ts
  - packages/semantic-core/src/__tests__/audit-log-service.integration.test.ts
  - apps/api/migrations/036_add_audit_logs.sql
  - apps/api/src/routes/audit-logs.ts
  - apps/dashboard/components/audit-log-viewer.tsx
  - apps/dashboard/components/audit-log-filter.tsx
  - apps/api/src/__tests__/audit-logs.test.ts
- **Depends on**: GDPR Data Subject Request Handler
- **Added**: 2026-06-07

### Task: API Key Rotation & Secret Management
- **Layer**: 33 — Advanced Security & Compliance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement secure API key lifecycle management including rotation, expiration, and secret vaulting. Extend apps/api/migrations/007_add_mcp_api_keys.sql to add: key_version (for rotation tracking), expiresAt (optional expiration), rotationSchedule (auto-rotate every N days), previousKeyHashes (keep history for deprecation grace period). Create packages/semantic-core/src/secret-vault.ts with SecretVault interface wrapping AES-256-GCM encryption at rest using Node.js crypto. Implement GET /api/v1/api-keys endpoint listing keys with masking (show first/last 4 chars only). Add POST /api/v1/api-keys/:id/rotate endpoint triggering rotation (generate new key, invalidate old after grace period, log rotation event). Add POST /api/v1/api-keys/:id/revoke for immediate deactivation. Build dashboard panel at apps/dashboard/components/api-key-manager.tsx with: key list, expiration warnings, rotation button, revocation confirmation, copy-to-clipboard for new keys. Implement graceful degradation: old keys still work for 7 days after rotation, with warnings in audit log. Full unit tests with mock crypto and integration tests with real Postgres encryption. Reference code-style.md for error handling and security patterns.
- **Files**:
  - packages/semantic-core/src/secret-vault.ts
  - packages/semantic-core/src/__tests__/secret-vault.test.ts
  - apps/api/migrations/037_enhance_api_key_management.sql
  - apps/api/src/routes/api-key-management.ts
  - apps/dashboard/components/api-key-manager.tsx
  - apps/api/src/__tests__/api-key-management.test.ts
- **Depends on**: MCP Server API Key Authentication & Workspace Isolation
- **Added**: 2026-06-07

### Task: Session Management & Device Tracking
- **Layer**: 33 — Advanced Security & Compliance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement user session tracking and device management for enhanced security monitoring. Create apps/api/migrations/038_add_session_tracking.sql with: user_sessions table (session_id, workspace_id, user_id, device_id, ip_address, user_agent, browserName, osName, createdAt, lastActivityAt, expiresAt), trusted_devices table (device_id, user_id, device_name, fingerprint, trustedAt, lastUsedAt). Implement SessionManager in packages/core/src/session-manager.ts with: createSession(userId, device), refreshSession(sessionId), revokeSession(sessionId), getActiveSessions(userId). Add dashboard page at apps/dashboard/app/settings/security/sessions/page.tsx showing: active sessions with location/device/last-activity, trusted devices list with rename/revoke buttons. Implement: (1) automatic session expiration after 30 days inactivity, (2) concurrent session limits (max 5 per user), (3) geo-anomaly detection (flag new country login), (4) device trust prompt on first use. Full tests with mocked device fingerprinting library. Reference api-conventions.md for auth patterns.
- **Files**:
  - packages/core/src/session-manager.ts
  - packages/core/src/__tests__/session-manager.test.ts
  - apps/api/migrations/038_add_session_tracking.sql
  - apps/api/src/routes/sessions.ts
  - apps/dashboard/app/settings/security/sessions/page.tsx
  - apps/dashboard/components/session-list.tsx
  - apps/dashboard/components/device-trust-dialog.tsx
  - apps/api/src/__tests__/sessions.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

---

## Layer 34: Observability & Debugging

### Task: Distributed Request Tracing & Correlation IDs
- **Layer**: 34 — Observability & Debugging
- **Status**: COMMITTED

- **Priority**: High
- **Description**: Implement distributed request tracing across all services (API, MCP server, workers) using correlation IDs for end-to-end request tracking. Create packages/core/src/request-context.ts with RequestContext class storing: (correlationId, traceId, spanId, userId, workspaceId, startTime). Add middleware to apps/api/src/middleware/request-context.ts that: (1) generates or extracts correlationId from request headers (X-Correlation-ID), (2) injects context into all downstream calls, (3) logs context with every structured log (via logger.info({...context}, message)). Implement HeaderPropagation in apps/mcp-server/src/context-propagation.ts to forward correlation IDs in MCP request metadata. Update packages/queue/ workers to extract and propagate context. Add GET /api/v1/admin/request/:correlationId endpoint returning full trace timeline (all logs, spans, latencies across services). Build debug dashboard page at apps/dashboard/app/admin/debugging/page.tsx with: request trace explorer (paste correlationId, view timeline), slow request finder (search by endpoint/latency threshold), error trace correlator (group logs by error). Full integration tests verifying correlation IDs flow correctly through async operations and queue jobs. Reference code-style.md for logging patterns.
- **Files**:
  - packages/core/src/request-context.ts
  - packages/core/src/__tests__/request-context.test.ts
  - apps/api/src/middleware/request-context.ts
  - apps/mcp-server/src/context-propagation.ts
  - apps/api/src/routes/request-traces.ts
  - apps/dashboard/app/admin/debugging/page.tsx
  - apps/dashboard/components/request-trace-explorer.tsx
  - apps/api/src/__tests__/request-traces.test.ts
- **Depends on**: Distributed Tracing Enhancements & Performance Profiling
- **Added**: 2026-06-07

### Task: Sync Error Recovery & Diagnostic Reports
- **Layer**: 34 — Observability & Debugging
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Enhance sync error handling with detailed diagnostics and automated recovery suggestions. Create packages/semantic-core/src/sync-diagnostics.ts with SyncDiagnosticsService: (1) categorizeError(error) classifying as: auth_failure, rate_limit, network_timeout, schema_mismatch, data_validation, quota_exceeded, (2) generateRecoveryPlan(error, context) suggesting remediation steps (e.g., "re-authorize OAuth", "wait 5 min before retry", "update field mappings"), (3) analyzeConnectorHealth(connectorId, lastNSyncs) detecting patterns (e.g., "failing on Sundays" → schedule conflict). Store diagnostics in sync_diagnostics table (sync_job_id, error_category, recovery_suggestions, is_resolved_at). Expose GET /api/v1/admin/sync-diagnostics/:connectorInstanceId returning: last 10 sync errors with categorization, recovery actions taken, resolution timeline. Build dashboard component at apps/dashboard/components/sync-error-diagnostic.tsx showing: error timeline, category breakdown, suggested actions with one-click execution (trigger retry with parameters). Add Email alerting with recovery steps. Full unit tests with 20+ error scenarios, integration tests with real sync failures. Reference code-style.md error handling patterns.
- **Files**:
  - packages/semantic-core/src/sync-diagnostics.ts
  - packages/semantic-core/src/__tests__/sync-diagnostics.test.ts
  - apps/api/migrations/039_add_sync_diagnostics.sql
  - apps/api/src/routes/sync-diagnostics.ts
  - apps/dashboard/components/sync-error-diagnostic.tsx
  - apps/dashboard/components/recovery-action-executor.tsx
  - apps/api/src/__tests__/sync-diagnostics.test.ts
- **Depends on**: Sync Worker Implementation & Connector Invocation
- **Added**: 2026-06-07

---

## Layer 35: Data Management & Governance

### Task: Index Snapshot Export & Disaster Recovery
- **Layer**: 35 — Data Management & Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement periodic index snapshots for disaster recovery and point-in-time restore capability. Create packages/semantic-core/src/index-snapshot.ts with IndexSnapshotService: (1) createSnapshot(workspaceId) exporting all entities, relationships, glossary, metrics to compressed archive (gzip + tar), (2) scheduleSnapshots(workspaceId, frequency: 'daily'|'weekly'|'monthly'), (3) listSnapshots(workspaceId) with metadata (size, created_at, entity_count), (4) restoreFromSnapshot(workspaceId, snapshotId) doing point-in-time restore with conflict resolution. Store snapshots to object storage (S3 or local filesystem). Add apps/api/migrations/040_add_snapshot_tracking.sql with index_snapshots table (snapshot_id, workspace_id, created_at, entity_count, snapshot_size_bytes, storage_path, retention_days). Expose GET /api/v1/admin/snapshots (list), POST /api/v1/admin/snapshots (create on-demand), POST /api/v1/admin/snapshots/:id/restore (restore). Build admin dashboard component at apps/dashboard/components/snapshot-manager.tsx with: snapshot list, download button, restore dialog with preview. Implement retention policy: keep last 30 snapshots, auto-delete after retentionDays. Full integration tests with real snapshot create/restore cycles. Reference code-style.md for error handling.
- **Files**:
  - packages/semantic-core/src/index-snapshot.ts
  - packages/semantic-core/src/__tests__/index-snapshot.integration.test.ts
  - apps/api/migrations/040_add_snapshot_tracking.sql
  - apps/api/src/routes/snapshots.ts
  - apps/dashboard/components/snapshot-manager.tsx
  - apps/api/src/__tests__/snapshots.test.ts
- **Depends on**: OSI (Open Semantic Interchange) Standard Export
- **Added**: 2026-06-07

### Task: Data Lineage Tracking & Provenance
- **Layer**: 35 — Data Management & Governance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement comprehensive data lineage tracking to show where each entity came from and how it was transformed. Create packages/semantic-core/src/data-lineage.ts with DataLineageService tracking: (1) source tracking (which connector, which sync job, original API timestamp), (2) transformation history (embeddings generated, deduplication applied, relationships added), (3) enrichment provenance (cross-connector links, field masking applied). Store in entity_lineage table (entity_id, source_connector_id, source_sync_job_id, source_api_timestamp, lineage_json, last_modified_by, last_modified_at). Expose GET /api/v1/entities/:id/lineage returning full provenance chain. Build dashboard visualization at apps/dashboard/components/entity-lineage-viewer.tsx with: entity origin (connector, sync time), transformation steps timeline, enrichments applied. Enable audit/compliance use case (prove where data came from). Full unit + integration tests. Reference code-style.md for JSON serialization patterns.
- **Files**:
  - packages/semantic-core/src/data-lineage.ts
  - packages/semantic-core/src/__tests__/data-lineage.test.ts
  - apps/api/migrations/041_add_data_lineage.sql
  - apps/api/src/routes/entity-lineage.ts
  - apps/dashboard/components/entity-lineage-viewer.tsx
  - apps/api/src/__tests__/entity-lineage.test.ts
- **Depends on**: Entity Relationship Indexing, MCP Server API Key Authentication & Workspace Isolation
- **Added**: 2026-06-07

---

## Layer 36: Billing & Monetization

### Task: Usage-Based Billing & Metering Infrastructure
- **Layer**: 36 — Billing & Monetization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a usage-based metering system to track and bill customers based on actual platform consumption. Create apps/api/migrations/042_add_billing_metering.sql with: usage_events table (workspace_id, event_type: 'entity_indexed'|'query_executed'|'token_spent'|'api_call', quantity, unit_price_cents, timestamp), billing_periods table (workspace_id, period_start, period_end, total_charges_cents, status: 'open'|'invoiced'|'paid'), and billing_tiers table (tier_name: 'starter'|'growth'|'enterprise', monthly_base_cents, entity_index_price_cents, query_price_cents, included_tokens). Create packages/semantic-core/src/billing-meter.ts with BillingMeter class: (1) recordUsage(workspaceId, eventType, quantity) persisting metered events, (2) calculateCharges(workspaceId, periodStart, periodEnd) summing events by type and applying tier pricing, (3) getWorkspaceTier(workspaceId) returning current plan tier. Implement Stripe integration in packages/core/src/stripe-client.ts for: payment processing, invoice generation, webhook handling (subscription updates). Expose GET /api/v1/billing/usage returning current period costs and forecasted month-end total. Wire usage recording into: indexer (on entity index), retrieval engine (on query), MCP tools (on invocation), and token analytics. Build dashboard billing page at apps/dashboard/app/settings/[workspaceId]/billing/page.tsx showing: current usage metrics (entities, queries, tokens), tiered pricing breakdown, month-to-date charges, upcoming invoice, upgrade button. Add 20+ unit tests for metering logic and integration tests with mocked Stripe API.
- **Files**:
  - packages/semantic-core/src/billing-meter.ts
  - packages/semantic-core/src/__tests__/billing-meter.test.ts
  - packages/semantic-core/src/__tests__/billing-meter.integration.test.ts
  - packages/core/src/stripe-client.ts
  - packages/core/src/__tests__/stripe-client.test.ts
  - apps/api/migrations/042_add_billing_metering.sql
  - apps/api/src/routes/billing.ts
  - apps/api/src/__tests__/billing.test.ts
  - apps/dashboard/app/settings/[workspaceId]/billing/page.tsx
  - apps/dashboard/components/billing-usage-chart.tsx
  - apps/dashboard/components/billing-invoice-list.tsx
- **Depends on**: Token Analytics Service & Dashboard, Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-07

### Task: Connector Marketplace & Discovery Platform
- **Layer**: 36 — Billing & Monetization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a connector marketplace and discovery system allowing users to browse, install, and manage connectors. Create apps/api/migrations/043_add_connector_marketplace.sql with: connector_listings table (id, connector_id, name, description, icon_url, documentation_url, popularity_score, workspace_installs_count, published_at), connector_reviews table (listing_id, reviewer_id, rating: 1–5, comment, created_at). Create packages/semantic-core/src/connector-marketplace.ts with ConnectorMarketplaceService: (1) getListings(filters: category, rating, popularity) returning paginated connector listings, (2) installConnector(workspaceId, connectorId) adding to workspace (calls registry to instantiate), (3) submitConnector(definition, icon, docs) allowing users to publish custom connectors, (4) getRatings(connectorId) and rateConnector(connectorId, rating, comment). Expose GET /api/v1/marketplace/connectors (with filtering/sorting), POST /api/v1/marketplace/connectors/:id/install, POST /api/v1/marketplace/connectors/:id/rate. Build marketplace discovery page at apps/dashboard/app/marketplace/page.tsx with: searchable connector grid, ratings/reviews, install buttons, detail modals with docs. Build admin curation dashboard at apps/dashboard/app/admin/marketplace-curation/page.tsx for approving/promoting connectors. Include popularity scoring: (installs × 0.4 + avg_rating × 0.3 + recency × 0.3). Add 18+ tests covering marketplace queries, curation workflows, and rating aggregation.
- **Files**:
  - packages/semantic-core/src/connector-marketplace.ts
  - packages/semantic-core/src/__tests__/connector-marketplace.test.ts
  - packages/semantic-core/src/__tests__/connector-marketplace.integration.test.ts
  - apps/api/migrations/043_add_connector_marketplace.sql
  - apps/api/src/routes/marketplace.ts
  - apps/api/src/__tests__/marketplace.test.ts
  - apps/dashboard/app/marketplace/page.tsx
  - apps/dashboard/components/connector-grid.tsx
  - apps/dashboard/components/connector-detail-modal.tsx
  - apps/dashboard/app/admin/marketplace-curation/page.tsx
  - apps/dashboard/components/connector-curation-panel.tsx
- **Depends on**: Connector Instance Management API, Workspace Onboarding Flow & First-Sync Guided Experience
- **Added**: 2026-06-07

---

## Layer 37: Response Caching & Query Optimization

### Task: Full Response-Level Caching for MCP Tools
- **Layer**: 37 — Response Caching & Query Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a second layer of caching that caches entire MCP tool responses, not just semantic embeddings. Create packages/cache/src/response-cache.ts with ResponseCache class: (1) cacheKey(tool, input) generating deterministic cache keys from tool name and validated input, (2) get(key) returning cached response if still valid, (3) set(key, response, ttl) storing full response with optional TTL override per tool, (4) invalidate(pattern) bulk invalidation using key patterns. Store in Redis with msgpack serialization for compact storage. Integrate into apps/mcp-server/src/server.ts: before executing any tool, check response cache; if hit and valid, return cached response immediately (log cache hit to audit); on cache miss, execute tool and cache result. Make caching configurable per tool (list-entities: 5min TTL, query-context: 2min TTL, get-metric: 1hour TTL). Add cache stats endpoint GET /api/v1/cache/stats showing hit rate, evictions, memory usage. Build admin dashboard panel at apps/dashboard/components/cache-stats-panel.tsx visualizing cache performance over time. Add 22+ tests covering: cache hit/miss logic, TTL expiration, serialization, pattern-based invalidation, and interaction with semantic cache.
- **Files**:
  - packages/cache/src/response-cache.ts
  - packages/cache/src/__tests__/response-cache.test.ts
  - packages/cache/src/__tests__/response-cache.integration.test.ts
  - apps/mcp-server/src/server.ts (update)
  - apps/api/src/routes/cache-stats.ts
  - apps/dashboard/components/cache-stats-panel.tsx
  - apps/mcp-server/src/__tests__/server.integration.test.ts (update)
- **Depends on**: Semantic Cache, MCP Server Bootstrap
- **Added**: 2026-06-07

### Task: Advanced Connector Retry & Resilience Patterns
- **Layer**: 37 — Response Caching & Query Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement sophisticated retry strategies and resilience patterns for all connectors to handle transient failures gracefully. Create packages/queue/src/connector-resilience.ts with ConnectorResilienceManager supporting: (1) configurable retry policies (max attempts, backoff strategy: exponential|linear|fibonacci with jitter), (2) circuit breaker pattern (fail-fast if error rate > threshold, reset after cooldown), (3) timeout configuration per connector (default 10s, configurable), (4) bulkhead pattern (limit concurrent requests per connector to avoid cascading failures). Store policies in connector_resilience_config table (connector_id, max_retries, backoff_strategy, circuit_breaker_threshold, timeout_ms, max_concurrent). Implement integration into sync-worker.ts: before invoking connector.sync(), wrap with resilience manager that enforces retry/timeout/circuit breaker logic. Add metrics tracking: retry_count, timeout_count, circuit_breaker_trips per connector. Expose GET /api/v1/admin/connectors/resilience returning resilience metrics and config. Build admin panel at apps/dashboard/components/connector-resilience-config.tsx allowing tuning of retry policies per connector with real-time metrics overlay. Add 25+ tests covering all retry scenarios, circuit breaker state transitions, timeout behavior, and bulkhead enforcement with synthetic workloads.
- **Files**:
  - packages/queue/src/connector-resilience.ts
  - packages/queue/src/__tests__/connector-resilience.test.ts
  - apps/api/migrations/044_add_connector_resilience.sql
  - apps/api/src/routes/admin-resilience.ts
  - apps/api/src/__tests__/admin-resilience.test.ts
  - apps/dashboard/components/connector-resilience-config.tsx
  - apps/api/src/workers/sync-worker.ts (update)
- **Depends on**: BullMQ Job Queue Infrastructure, Connector Rate Limiting & Backoff Strategy Manager
- **Added**: 2026-06-07

### Task: Bulk Data Import & Export UI
- **Layer**: 37 — Response Caching & Query Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a user-friendly import/export interface for bulk data operations, enabling testing and migration workflows. Create apps/dashboard/app/data-tools/page.tsx with tabs: (1) Import Data (CSV/JSON file upload, field mapping wizard, preview, execute import), (2) Export Data (select entities to export, format picker: CSV/JSON/Parquet, download), (3) Migration Tools (export from workspace A, import to workspace B with entity matching/deduplication options). Implement backend: POST /api/v1/data/import accepting multipart form with file + mappings, executing async job, tracking progress. POST /api/v1/data/export with filters returning streamed file. Create packages/semantic-core/src/data-import-export.ts with: (1) parseCSV/parseJSON (detect schema automatically), (2) validateMapping(rows, schema) ensuring field compatibility, (3) transformRows(rows, mapping) converting to SemanticEntity, (4) batchInsert(entities, workspaceId) feeding into indexer. Add file size limits (max 100MB), entity count limits (max 50K per import), and job history tracking. Build import/export job history page showing: status, record count, timestamp, download links for exports, retry button for failed imports. Add 20+ tests covering: CSV parsing, schema detection, entity transformation, error handling (missing fields, type mismatches), and async job orchestration.
- **Files**:
  - packages/semantic-core/src/data-import-export.ts
  - packages/semantic-core/src/__tests__/data-import-export.test.ts
  - apps/api/migrations/045_add_import_export_jobs.sql
  - apps/api/src/routes/data-import-export.ts
  - apps/api/src/__tests__/data-import-export.test.ts
  - apps/dashboard/app/data-tools/page.tsx
  - apps/dashboard/components/import-wizard.tsx
  - apps/dashboard/components/export-configurator.tsx
  - apps/dashboard/components/job-history-table.tsx
- **Depends on**: Workspace Data Export & Backup Service, Entity Relationship Indexing
- **Added**: 2026-06-07

---

## Layer 38: Testing & Developer Experience

### Task: Connector Integration Testing Framework & Test Utilities
- **Layer**: 38 — Testing & Developer Experience
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a comprehensive testing framework for connector developers to simplify connector implementation and validation. Create packages/connector-sdk/src/testing/connector-test-harness.ts with ConnectorTestHarness class providing: (1) createTestContext(connectorConfig) setting up mocked API client, test database, and mock data, (2) mockConnectorAPI(responses) setting up MSW handlers per vendor, (3) assertSyncOutput(result, expectedEntities) validating sync generator output matches schema, (4) assertEntityShape(entity) strict validation per connector manifest, (5) timeoutAssertion(operation, maxMs) verifying operation completes within latency SLA. Add test fixtures in packages/connector-sdk/tests/fixtures/ with real API responses for: HubSpot (contacts, companies, deals), Slack (channels, users, messages), Notion (databases, pages). Create a test generator: generateConnectorTest(connectorId) that scaffolds a test file with boilerplate for: connect, sync, healthCheck, error handling. Implement ConnectorTestRunner CLI tool that runs all connector tests and generates a test report (coverage %, pass rate, performance metrics). Add documentation guide at packages/connector-sdk/README.test.md with examples. Include 30+ unit tests validating test harness correctness and 5 reference connector test suites demonstrating best practices.
- **Files**:
  - packages/connector-sdk/src/testing/connector-test-harness.ts
  - packages/connector-sdk/src/testing/test-generator.ts
  - packages/connector-sdk/src/testing/__tests__/connector-test-harness.test.ts
  - packages/connector-sdk/tests/fixtures/hubspot-responses.json
  - packages/connector-sdk/tests/fixtures/slack-responses.json
  - packages/connector-sdk/tests/fixtures/notion-responses.json
  - packages/connector-sdk/bin/test-runner.ts
  - packages/connector-sdk/README.test.md
  - packages/connector-sdk/examples/example-connector.test.ts
- **Depends on**: Connector Test Utilities, Comprehensive Webhook Validation & Testing Suite
- **Added**: 2026-06-07

---

## Layer 39: LLM Provider Abstraction & Multi-Model Support

### Task: LLM Provider Abstraction Layer & Multi-Embedding Model Support
- **Layer**: 39 — LLM Provider Abstraction & Multi-Model Support
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Abstract embedding model selection to support multiple LLM providers (OpenAI, Azure OpenAI, Anthropic, local Ollama, Cohere) instead of hardcoding OpenAI text-embedding-3-small. Create packages/semantic-core/src/embedding-provider.ts with EmbeddingProvider interface: getEmbedding(text: string), batchEmbeddings(texts: string[]), getModelDimensions(), getModelId(). Implement concrete providers: OpenAIProvider, AzureOpenAIProvider, OllamaProvider, CohereProvider. Update embedding.ts to use the provider pattern. Add configuration in env vars: EMBEDDING_PROVIDER (openai|azure|ollama|cohere), EMBEDDING_MODEL_ID, and provider-specific credentials. Create database migration 046_add_embedding_metadata.sql with: embedding_metadata table (workspace_id, model_id, dimension, created_at) to track which model version indexed each entity. Update indexer to record model_id with embeddings. Add a re-indexing utility in packages/semantic-core/src/reindex-utils.ts to migrate embeddings between models (batch-convert old embeddings to new provider, store both during transition). Expose GET /api/v1/admin/embedding-config and PUT /api/v1/admin/embedding-config/migrate to change providers. Add 28+ unit tests for each provider, batch handling, and dimension mismatches. Reference embedding-patterns.md for cost control and token limits per model. See code-style.md for error handling and config validation rules.
- **Files**:
  - packages/semantic-core/src/embedding-provider.ts
  - packages/semantic-core/src/providers/openai-provider.ts
  - packages/semantic-core/src/providers/azure-openai-provider.ts
  - packages/semantic-core/src/providers/ollama-provider.ts
  - packages/semantic-core/src/providers/cohere-provider.ts
  - packages/semantic-core/src/reindex-utils.ts
  - packages/semantic-core/src/embedding.ts (update)
  - packages/semantic-core/src/__tests__/embedding-provider.test.ts
  - packages/semantic-core/src/__tests__/reindex-utils.test.ts
  - apps/api/migrations/046_add_embedding_metadata.sql
  - apps/api/src/routes/admin-embedding.ts
  - apps/api/src/__tests__/admin-embedding.test.ts
- **Depends on**: Embedding Service
- **Added**: 2026-06-07

### Task: Vector Index Health Monitoring & Drift Detection
- **Layer**: 39 — LLM Provider Abstraction & Multi-Model Support
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement health checks and drift detection for the vector index to ensure semantic quality over time. Create packages/semantic-core/src/vector-health.ts with VectorHealthService: (1) analyzeVectorDrift(workspaceId, sampleSize: 1000) computing vector statistics (centroid, variance, density) and detecting distribution shifts indicating stale or low-quality embeddings, (2) validateEmbeddingConsistency(entityIds) re-embedding a sample of entities and comparing similarity to stored embeddings (flag drifts > 0.05 as potential quality issues), (3) detectOutliers(workspaceId) finding entities with anomalous vectors via isolation forest or statistical bounds, (4) generateHealthReport(workspaceId) aggregating metrics into: overall_health_score (0–100), quality_issues_count, recommended_actions. Store health check results in vector_health_checks table (workspace_id, check_timestamp, drift_score, outlier_count, consistency_score, report_json). Expose GET /api/v1/admin/vector-health returning current status and historical trends. Build admin dashboard panel at apps/dashboard/components/vector-health-monitor.tsx showing: health trend chart, drift alerts, recommended re-indexing, manual health check trigger. Integrate health checks into sync completion workflow (after large syncs, run health check). Add 24+ tests covering drift detection, consistency validation, outlier detection with synthetic vector data. Reference embedding-patterns.md for quality thresholds and cost implications of re-indexing.
- **Files**:
  - packages/semantic-core/src/vector-health.ts
  - packages/semantic-core/src/__tests__/vector-health.test.ts
  - apps/api/migrations/047_add_vector_health.sql
  - apps/api/src/routes/vector-health.ts
  - apps/api/src/__tests__/vector-health.test.ts
  - apps/dashboard/components/vector-health-monitor.tsx
  - packages/semantic-core/src/indexer.ts (update: post-sync health check trigger)
- **Depends on**: Indexer Implementation, Vector Store Interface
- **Added**: 2026-06-07

---

## Layer 40: Advanced Agent & Workflow Features

### Task: Agent Workflow Templates & Pre-Configured Context Flows
- **Layer**: 40 — Advanced Agent & Workflow Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build pre-configured workflow templates that allow non-technical users to compose multi-step agent flows with Iris context automatically injected. Create packages/semantic-core/src/workflow-templates.ts with WorkflowTemplateService: (1) listTemplates(workspaceId, category) returning curated templates (e.g., 'Sales QA', 'Finance Reporting', 'Customer Support'), (2) instantiateTemplate(workspaceId, templateId, params) creating a workflow instance with templated steps, (3) enrichWorkflowContext(workflowId) calling retrieval engine to fetch relevant context for each step in advance. Define WorkflowTemplate schema: steps (array of {type: 'mcp-query'|'llm-reason'|'webhook-notify', config}), contextDefinitions (array of entity types/metrics needed), timeout, triggerCondition (manual|scheduled|webhook). Store in workflows table (workspace_id, template_id, status, created_by, created_at, last_executed_at). Build workflow template builder UI at apps/dashboard/app/workflows/templates/page.tsx with: template gallery (searchable/filterable), create custom template wizard (drag-drop steps, configure context injection), test template flow simulator. Expose POST /api/v1/workflows with template schema, GET /api/v1/workflows/:id/run to execute workflow (context is fetched and injected into each MCP query automatically). Add 18+ tests covering template instantiation, context injection, step execution, and error handling. See api-conventions.md for workflow execution API structure.
- **Files**:
  - packages/semantic-core/src/workflow-templates.ts
  - packages/semantic-core/src/__tests__/workflow-templates.test.ts
  - apps/api/migrations/048_add_workflows.sql
  - apps/api/src/routes/workflows.ts
  - apps/api/src/__tests__/workflows.test.ts
  - apps/dashboard/app/workflows/templates/page.tsx
  - apps/dashboard/app/workflows/[id]/page.tsx
  - apps/dashboard/components/workflow-builder.tsx
  - apps/dashboard/components/workflow-executor.tsx
- **Depends on**: Retrieval Engine, MCP Server Bootstrap, Proactive Context Surfacing (V2 Intelligence)
- **Added**: 2026-06-07

### Task: MCP Resources Support & Document/File Streaming
- **Layer**: 40 — Advanced Agent & Workflow Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend MCP server to expose both tools (current implementation) and resources — allowing Claude and other agents to read indexed documents and files directly via MCP resources. Implement MCP resources for: (1) indexed document sources (e.g., GET file:///workspace/document-id returning file content with metadata), (2) entity detail resources (GET entity:///hubspot:contact:12345 returning full entity JSON), (3) relationship subgraphs (GET graph:///entity-id?depth=2 returning entity + related entities as JSON). Update apps/mcp-server/src/server.ts to add resources alongside tools using MCP ResourceListResponseSchema and ResourceReadResponseSchema. Support streaming for large documents (chunked transfer via resource_content with pagination). Add permission checks (resource access respects role-based context permissions). Implement in retrieval engine: buildEntityResource(entityId, workspaceId, depth) and buildDocumentResource(docId, workspaceId). Add resource discovery: GET /api/v1/mcp/resources endpoint listing all available resources per workspace (enable IDE autocomplete for resource URIs). Build dashboard page at apps/dashboard/app/mcp/resources/page.tsx showing: available resources, sample URIs, rate limiting per resource type. Add 20+ tests covering resource schemas, pagination, permission enforcement, and streaming behavior.
- **Files**:
  - apps/mcp-server/src/server.ts (update)
  - apps/mcp-server/src/resources/entity-resource.ts
  - apps/mcp-server/src/resources/document-resource.ts
  - apps/mcp-server/src/resources/graph-resource.ts
  - packages/semantic-core/src/resource-builder.ts
  - apps/api/src/routes/mcp-resources.ts
  - apps/dashboard/app/mcp/resources/page.tsx
  - apps/mcp-server/src/__tests__/resources.test.ts
  - apps/api/src/__tests__/mcp-resources.test.ts
- **Depends on**: MCP Server Bootstrap, Entity Relationship Indexing
- **Added**: 2026-06-07

---

## Layer 41: SIRA-Inspired Retrieval Improvements

### Task: Hybrid BM25 + Vector Retrieval with Reciprocal Rank Fusion
- **Layer**: 41 — SIRA-Inspired Retrieval Improvements
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Add a sparse BM25 retrieval layer alongside the existing dense vector search, then combine both ranked lists using Reciprocal Rank Fusion (RRF). Inspired by Meta's SIRA paper, which shows sparse lexical retrieval is highly complementary to dense search for exact-match lookups. Implementation: (1) add migration 049_add_fts_vector.sql adding a `fts_vector tsvector` column to the entities table, populated from entity label + all attribute values via a Postgres trigger; add a GIN index on `fts_vector`. (2) Add `bm25Search(workspaceId, queryText, topK, entityTypes?)` method to PgvectorStore in packages/semantic-core/src/vector-store.ts using `ts_rank_cd` and `plainto_tsquery`. (3) Update `retrieveContext` in packages/semantic-core/src/retrieval.ts to run BM25 and vector searches in parallel, then merge results with RRF: `rrf_score = 1/(k + rank_bm25) + 1/(k + rank_vector)` where k=60. Return top-K by combined score. (4) Expose `hybridSearch: boolean` option in RetrievalOptions (default true). Add unit tests for BM25 search, RRF merge logic, and integration tests verifying exact-match queries ("find invoice INV-2024-0312", "Acme Corp deal") rank correctly where vector search alone underperforms.
- **Files**:
  - apps/api/migrations/049_add_fts_vector.sql
  - packages/semantic-core/src/vector-store.ts (update: add bm25Search method)
  - packages/semantic-core/src/retrieval.ts (update: hybrid search + RRF merge)
  - packages/semantic-core/src/__tests__/retrieval.test.ts (update)
  - packages/semantic-core/src/__tests__/vector-store.integration.test.ts (update)
- **Depends on**: Vector Store Interface, Retrieval Engine
- **Added**: 2026-06-07

### Task: Corpus-Discriminative Embedding Inputs via Attribute Frequency Filtering
- **Layer**: 41 — SIRA-Inspired Retrieval Improvements
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Improve embedding quality by excluding high-frequency attribute values from embedding inputs at index time. Inspired by SIRA's corpus-discriminative filtering: attributes shared by >60% of same-type entities within a workspace carry no discriminative signal and dilute embedding similarity boundaries (e.g., `stage: Negotiation` on 65% of deals, `country: US` on 80% of contacts). Implementation: (1) add migration 050_add_attribute_frequency.sql with table `entity_attribute_frequency (workspace_id, entity_type, attr_key, attr_value_hash, occurrence_count, total_entities, frequency_ratio, updated_at)`. (2) Create packages/semantic-core/src/attribute-frequency.ts with AttributeFrequencyTracker: `recordAttributes(workspaceId, entityType, attrs)` updating frequency counts incrementally on each sync, and `isDiscriminative(workspaceId, entityType, attrKey, attrValue): Promise<boolean>` returning false when frequency_ratio > 0.6. (3) Update `buildEmbeddingInput()` in packages/semantic-core/src/embedding.ts to call `isDiscriminative()` and omit non-discriminative attribute values (keep the key but replace value with a placeholder, or drop the pair entirely). Cache frequency lookups in-memory per indexer run (LRU, 1000 entries). Add unit tests with synthetic high-frequency attribute data and integration tests verifying embedding inputs exclude corpus-common terms.
- **Files**:
  - apps/api/migrations/050_add_attribute_frequency.sql
  - packages/semantic-core/src/attribute-frequency.ts
  - packages/semantic-core/src/embedding.ts (update: discriminative input filter)
  - packages/semantic-core/src/indexer.ts (update: wire AttributeFrequencyTracker)
  - packages/semantic-core/src/__tests__/attribute-frequency.test.ts
  - packages/semantic-core/src/__tests__/embedding.test.ts (update)
- **Depends on**: Embedding Service, Indexer Implementation
- **Added**: 2026-06-07

### Task: Query Expansion with Corpus-Frequency Filtering
- **Layer**: 41 — SIRA-Inspired Retrieval Improvements
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the query decomposer to predict domain vocabulary missing from the user's query, then filter predicted terms using corpus statistics before embedding — mirroring SIRA's query-side LLM expansion. Implementation: (1) add `expandQuery(query, workspaceId, availableEntityTypes, apiKey): Promise<string>` to packages/semantic-core/src/query-decomposer.ts. The function prompts gpt-4o-mini with the query and a brief workspace schema summary to predict 5–8 additional domain terms (e.g., "what's our pipeline this quarter?" → ["deal stage", "forecast", "close date", "ARR", "Q3"]). (2) Filter predicted terms against the attribute frequency table: drop terms that appear in >70% of workspace entities (too common) or in <1% (too rare to match anything). (3) Concatenate surviving expansion terms to the original query before embedding in `retrieveContext`: `const embeddingInput = query + ' ' + expansions.join(' ')`. Gate behind `queryExpansion: boolean` option in RetrievalOptions (default false initially). Cache expansion results by query hash in Redis (TTL: 1 hour) to avoid repeated LLM calls on the same query. Add unit tests with mocked LLM responses and corpus frequency data, verifying filtering removes corpus-common and corpus-absent terms. Integration tests verifying expanded queries improve recall on sparse queries.
- **Files**:
  - packages/semantic-core/src/query-decomposer.ts (update: add expandQuery)
  - packages/semantic-core/src/retrieval.ts (update: apply expansion before embedQuery)
  - packages/semantic-core/src/__tests__/query-decomposer.test.ts (update)
  - packages/semantic-core/src/__tests__/retrieval.test.ts (update)
- **Depends on**: Corpus-Discriminative Embedding Inputs via Attribute Frequency Filtering, Query Decomposition & Entity Type Detection
- **Added**: 2026-06-07

### Task: Offline Entity Enrichment with LLM-Predicted Search Vocabulary
- **Layer**: 41 — SIRA-Inspired Retrieval Improvements
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: At index time, optionally augment entity embedding inputs with LLM-predicted domain vocabulary that is missing from the raw entity attributes — the corpus-side enrichment technique from SIRA. This improves recall for natural language queries that use different terminology than the raw data (e.g., a Jira issue titled "Q3-ENT-2204" would be enriched with predicted terms like "enterprise ticket Q3 bug sprint backlog"). Implementation: (1) create packages/semantic-core/src/entity-enricher.ts with EntityEnricher class: `enrichEntity(entity, workspaceId): Promise<string[]>` calls gpt-4o-mini with the entity's type, label, and attributes, asking it to predict 5–10 additional search terms a user might use to find this entity. Returns deduplicated predicted terms filtered against corpus frequency (drop terms with ratio > 0.7). (2) Cache enrichment results by entity content hash in Redis (TTL: 7 days — enrichment only changes if entity data changes). (3) Integrate into indexer.ts: when `enrichEntities: true` option is set in IndexerConfig, call enrichEntity() after building the embedding input and append surviving terms to the embedding string before the API call. (4) Gate by entity type allowlist in IndexerConfig (e.g., enrich only `issue`, `transaction`, `document` types — not `contact` or `deal` which already have rich attributes). Add unit tests with mocked LLM responses, cache hit/miss behavior. Integration tests comparing retrieval recall with and without enrichment on a synthetic sparse-attribute dataset.
- **Files**:
  - packages/semantic-core/src/entity-enricher.ts
  - packages/semantic-core/src/indexer.ts (update: wire EntityEnricher, add enrichEntities config)
  - packages/semantic-core/src/__tests__/entity-enricher.test.ts
  - packages/semantic-core/src/__tests__/indexer.test.ts (update)
- **Depends on**: Corpus-Discriminative Embedding Inputs via Attribute Frequency Filtering, Embedding Service
- **Added**: 2026-06-07

---

## Layer 42: Source Control Integration

### Task: GitHub Connector with Issues, PRs & Repository Context
- **Layer**: 42 — Source Control Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement GitHub connector in packages/connectors/github/ to sync repositories, issues, pull requests, and discussions as SemanticEntity objects. Connect via OAuth2 to GitHub API (graphql + rest endpoints). Sync entity types: (1) `repository` (name, description, topics, language, stargazers, forks), (2) `issue` (title, body, state, assignees, labels, milestone, linked PRs), (3) `pull_request` (title, description, state, author, reviewers, commits, linked issues), (4) `discussion` (title, body, category, answers). Support incremental sync via updatedAt cursor using search API for efficient delta queries. Extract relationships: issue ↔ pull_request (via "closes" mentions), pull_request → repository, issue → assignee (linked entity IDs). Use MSW for tests with fixture responses from GitHub GraphQL schema. Include ConnectorManifest with GitHub App OAuth scopes (repo:read, discussions:read). Add 20+ unit tests covering pagination, relationship extraction, incremental filtering, and error handling. Integration tests with real Postgres. Follow connector-patterns.md for entity transformation and embedding-patterns.md for relationship representation.
- **Files**:
  - packages/connectors/github/src/github-connector.ts
  - packages/connectors/github/src/manifest.ts
  - packages/connectors/github/src/transformers.ts
  - packages/connectors/github/src/__tests__/github-connector.test.ts
  - packages/connectors/github/tests/fixtures/repositories.json
  - packages/connectors/github/tests/fixtures/issues.json
  - packages/connectors/github/tests/fixtures/pull-requests.json
  - packages/connectors/github/package.json
- **Depends on**: HubSpot Connector, Entity Relationship Indexing
- **Added**: 2026-06-08

### Task: Advanced Query Filter Builder UI Component
- **Layer**: 42 — Source Control Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an interactive query filter builder UI component for the advanced-query-context MCP tool. Create apps/dashboard/components/advanced-query-builder.tsx with: (1) visual filter chain editor (drag-drop filter rules), (2) entity type selector (dropdown listing indexed entity types per workspace), (3) attribute picker (dynamically load attributes for selected entity type from schema), (4) filter operators (=, !=, >, <, >=, <=, contains, in, startsWith, endsWith), (5) value input (text field with autocomplete for enum attributes), (6) aggregation selector (sum, count, avg, min, max with groupBy), (7) real-time query string preview (shows the filter syntax being constructed), (8) "Execute Query" button triggering POST /api/v1/advanced-query with the constructed filter. Add validation: prevent filters on non-existent attributes, type-check values against attribute type, warn if filter matches 0 entities. Build as a modal/sidebar component. Include unit tests with React Testing Library verifying: filter rule addition/removal, operator changes, aggregation selection, query string generation. Add integration test verifying constructed filter matches backend parsing logic (test round-trip: UI builder → filter string → backend parser → SQL equivalent).
- **Files**:
  - apps/dashboard/components/advanced-query-builder.tsx
  - apps/dashboard/components/__tests__/advanced-query-builder.test.tsx
  - apps/dashboard/components/filter-rule-editor.tsx
  - apps/dashboard/components/attribute-picker.tsx
  - apps/dashboard/components/query-preview.tsx
- **Depends on**: Advanced MCP Query Features & Aggregations
- **Added**: 2026-06-08

### Task: Connector Sync Quality Metrics & Anomaly Detection
- **Layer**: 42 — Source Control Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement automated quality monitoring for connector syncs to detect data degradation and schema changes. Create packages/semantic-core/src/sync-quality-monitor.ts with SyncQualityMonitor service: (1) recordSyncMetrics(syncId, metrics) tracking: entity_count, attribute_completeness (% non-null), unique_value_ratio (entropy per attribute), schema_stability (unchanged attribute count / total attributes), (2) detectAnomalies(connectorId) comparing current sync stats against 30-day historical baseline using z-score: alert if entity_count deviates >3σ, if completeness drops >20%, if new attributes appear (schema drift), (3) trackDataQualityTrend(connectorId, windowDays) returning trend indicators. Store metrics in sync_quality_metrics table (sync_id, connector_id, entity_count, completeness_pct, schema_stability_pct, anomaly_flags, recorded_at). Expose GET /api/v1/admin/connectors/:id/quality returning current + historical metrics, POST /api/v1/admin/connectors/:id/quality/configure to set anomaly thresholds. Build admin dashboard at apps/dashboard/app/admin/sync-quality/page.tsx with: quality trend chart per connector (entity count line, completeness gauge, schema drift indicator), anomaly alert list with drill-down details. Wire quality checks into the sync-job-queue to emit warnings/errors on anomalies. Add 15+ unit tests with synthetic metrics fixtures, integration tests verifying baseline calculation and anomaly detection. Reference embedding-patterns.md for cost control (quality checks should be lightweight).
- **Files**:
  - packages/semantic-core/src/sync-quality-monitor.ts
  - packages/semantic-core/src/__tests__/sync-quality-monitor.test.ts
  - packages/semantic-core/src/__tests__/sync-quality-monitor.integration.test.ts
  - apps/api/migrations/044_add_sync_quality_metrics.sql
  - apps/api/src/routes/admin-sync-quality.ts
  - apps/dashboard/app/admin/sync-quality/page.tsx
  - apps/dashboard/components/sync-quality-monitor.tsx
  - apps/api/src/__tests__/admin-sync-quality.test.ts
- **Depends on**: BullMQ Job Queue Infrastructure, Sync Worker Implementation & Connector Invocation
- **Added**: 2026-06-08

---

## Layer 43: Search Quality & Cost Optimization

### Task: Advanced Entity Deduplication with Rule-Based Matching
- **Layer**: 43 — Search Quality & Cost Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement rule-based entity deduplication to complement cosine similarity matching, enabling high-precision dedup for entities with structured attributes. Create packages/semantic-core/src/entity-deduplicator.ts with EntityDeduplicator class: (1) defineDeduplicationRules(workspaceId, entityType, rules) allowing users to specify exact-match rules (e.g., "contacts with same email AND domain belong to same customer"), fuzzy-match rules (levenshtein distance on name fields), and composite rules (AND/OR logic combining multiple conditions). (2) applyRules(entities, entityType) running rule engine to partition entities into groups and merge within groups. (3) scoreCandidate(entity1, entity2, rules): Promise<number> returning 0–1 confidence via: embedding cosine similarity (0.5 weight), rule match count (0.3 weight), value overlap ratio (0.2 weight). Wire into indexer.ts during flushBatch: after cosine dedup, apply rule-based dedup as a second pass to catch structural duplicates missed by embeddings. Store dedup rules in entity_dedup_rules table (workspace_id, entity_type, rule_json, enabled_at, created_by). Expose POST /api/v1/admin/dedup-rules (define rule), GET /api/v1/admin/dedup-rules (list rules), and PUT /api/v1/admin/dedup-rules/:id/test (preview matches on sample data). Build admin UI at apps/dashboard/app/admin/dedup/page.tsx with: rule builder (visual editor for conditions), test data input (paste entities), preview matched groups, confidence scores. Add 22+ unit tests covering rule evaluation logic (exact match, fuzzy match, composite rules, edge cases), and integration tests verifying end-to-end dedup with real entity data. Reference embedding-patterns.md for cost implications of running additional matching passes.
- **Files**:
  - packages/semantic-core/src/entity-deduplicator.ts
  - packages/semantic-core/src/__tests__/entity-deduplicator.test.ts
  - packages/semantic-core/src/__tests__/entity-deduplicator.integration.test.ts
  - packages/semantic-core/src/indexer.ts (update: wire rule-based dedup into flushBatch)
  - apps/api/migrations/051_add_dedup_rules.sql
  - apps/api/src/routes/admin-dedup.ts (update)
  - apps/dashboard/app/admin/dedup/page.tsx (update)
  - apps/api/src/__tests__/admin-dedup.test.ts (update)
- **Depends on**: Indexer Implementation, Semantic Cache
- **Added**: 2026-06-08

### Task: Per-Connector Cost Attribution & Billing Breakdown
- **Layer**: 43 — Search Quality & Cost Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend billing infrastructure to track and report costs per connector, enabling data-driven decisions about which integrations deliver ROI. Create packages/semantic-core/src/connector-cost-attribution.ts with ConnectorCostAttributor class: (1) recordConnectorCost(workspaceId, connectorId, event: 'entity_indexed'|'query_executed', quantity, costCents) and aggregateByConnector(workspaceId, periodStart, periodEnd): Promise<{connectorId, entityCount, indexCosts, queryCosts, totalCosts}>. Store in connector_cost_attribution table (workspace_id, connector_id, period_start, period_end, entity_count_indexed, index_cost_cents, query_cost_cents, tokens_spent, tokens_saved, created_at). (2) Implement cost calculation: indexing cost = (entities × embedding_model_cost_per_entity) + (kb_stored × storage_cost), query cost = (queries × avg_tokens_per_query × token_cost). (3) Wire into: sync-worker (record index costs after sync completion), retrieval engine (record query costs per MCP invocation). Expose GET /api/v1/billing/connectors returning: cost breakdown per connector (cost rank, % of total, 30-day trend), top ROI connectors (queries per $1 spent), and recommendations (disable low-ROI connectors, consolidate overlapping ones). Build analytics dashboard at apps/dashboard/app/analytics/[workspaceId]/breakdown/page.tsx with: cost-per-connector bar chart (sortable), ROI scatterplot (x=cost, y=queries), month-over-month trend, and "disable low-ROI" recommendation panel with one-click action. Add 20+ unit tests for cost calculation logic and aggregation, integration tests verifying costs are correctly attributed during real syncs and queries. Reference embedding-patterns.md for cost control and billing-meter.ts for metering patterns.
- **Files**:
  - packages/semantic-core/src/connector-cost-attribution.ts
  - packages/semantic-core/src/__tests__/connector-cost-attribution.test.ts
  - packages/semantic-core/src/__tests__/connector-cost-attribution.integration.test.ts
  - apps/api/migrations/052_add_connector_cost_attribution.sql
  - apps/api/src/routes/billing.ts (update: add connector breakdown endpoints)
  - apps/dashboard/app/analytics/[workspaceId]/breakdown/page.tsx (update or create)
  - apps/dashboard/components/connector-cost-chart.tsx
  - apps/dashboard/components/roi-scatterplot.tsx
  - apps/api/src/__tests__/billing.test.ts (update)
- **Depends on**: Usage-Based Billing & Metering Infrastructure
- **Added**: 2026-06-08

### Task: Search Quality Evaluation & A/B Testing Framework
- **Layer**: 43 — Search Quality & Cost Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an evaluation framework for measuring and comparing retrieval quality across different ranking algorithms, embeddings, and retrieval strategies (exact match vs. semantic, BM25 tuning, etc.). Create packages/semantic-core/src/search-quality-evaluator.ts with SearchQualityEvaluator: (1) defineTestSet(workspaceId, queries, expectedEntities) where users upload query → expected entities mappings for evaluation, (2) measureMetrics(results, expected) computing: precision@k, recall@k, NDCG@k, MRR (mean reciprocal rank), (3) compareStrategies(testSet, [strategy1, strategy2, ...]) running all strategies and returning comparative metrics. Implement A/B testing workflow: POST /api/v1/admin/search-experiments (define experiment with control/treatment retrievers), GET /api/v1/admin/search-experiments/:id/results (live metrics, confidence intervals), PUT /api/v1/admin/search-experiments/:id/promote (apply winning strategy to production). Store test sets and results in search_quality_evaluations table (workspace_id, test_set_id, query, expected_entity_ids, created_by, created_at) and search_experiment_results table (experiment_id, strategy_name, precision_at_5, recall_at_10, ndcg, sample_size, timestamp). Build admin UI at apps/dashboard/app/admin/query-analytics/page.tsx (or create new page) with: test set manager (upload/review query sets), active experiments (live metrics dashboard), strategy comparison (side-by-side results), promotion UI. Implement controlled rollout: keep control strategy, gradually shift traffic to treatment via random sampling (10% → 25% → 50% → 100%). Add 18+ unit tests for metric calculations and comparison logic, integration tests verifying experiment lifecycle and promotion safety. Reference code-style.md for experiment state management and logging patterns.
- **Files**:
  - packages/semantic-core/src/search-quality-evaluator.ts
  - packages/semantic-core/src/__tests__/search-quality-evaluator.test.ts
  - packages/semantic-core/src/__tests__/search-quality-evaluator.integration.test.ts
  - apps/api/migrations/053_add_search_quality_evaluation.sql
  - apps/api/src/routes/admin-query-analytics.ts (update)
  - apps/dashboard/app/admin/query-analytics/page.tsx (update with experiment features)
  - apps/dashboard/components/search-quality-dashboard.tsx
  - apps/dashboard/components/experiment-comparison-table.tsx
  - apps/api/src/__tests__/admin-query-analytics.test.ts (update)
- **Depends on**: Retrieval Engine, Hybrid BM25 + Vector Retrieval with Reciprocal Rank Fusion
- **Added**: 2026-06-08

### Task: Cost Optimization Advisor with Token Spend Recommendations
- **Layer**: 43 — Search Quality & Cost Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement an ML-driven advisor that analyzes workspace usage patterns and recommends cost-saving actions. Create packages/semantic-core/src/cost-optimizer.ts with CostOptimizationAdvisor: (1) analyzeSpendPatterns(workspaceId, windowDays: 30) computing: tokens spent per day, cost per query, top queries by token spend, cache hit rate, compression efficiency, (2) generateRecommendations() returning ranked list of optimization opportunities with estimated token savings: (a) "enable semantic cache" (if hit rate < 15%, save est. X tokens/day), (b) "tune context budget" (if avg query uses < 30% budget, reduce and save X tokens), (c) "consolidate low-ROI connectors" (if connector A and B have >0.9 cosine overlap, disable A and save indexing costs), (d) "archive stale entities" (entities not queried in 90 days can be offloaded), (e) "upgrade to large embedding model" (if search quality below threshold, invest in better embeddings). Each recommendation includes: title, description, estimated_savings_tokens_per_day, estimated_savings_cost_monthly, implementation_effort ('low'|'medium'|'high'), and one-click apply action. Store recommendations in cost_optimization_recommendations table (workspace_id, recommendation_id, type, estimated_savings_cents, applied_at, savings_realized_cents). Expose GET /api/v1/cost-optimizer/recommendations returning current opportunities and historical savings realized. Build dashboard widget at apps/dashboard/components/cost-optimizer-panel.tsx showing: top 3 recommendations with savings estimate, "apply all low-effort" quick action button, realized savings graph. Add 16+ unit tests for pattern analysis and recommendation logic, integration tests with synthetic spending data and recommendation application. Reference embedding-patterns.md for cost control budgets and code-style.md for recommendation scoring logic.
- **Files**:
  - packages/semantic-core/src/cost-optimizer.ts
  - packages/semantic-core/src/__tests__/cost-optimizer.test.ts
  - packages/semantic-core/src/__tests__/cost-optimizer.integration.test.ts
  - apps/api/migrations/054_add_cost_recommendations.sql
  - apps/api/src/routes/cost-optimizer.ts
  - apps/dashboard/components/cost-optimizer-panel.tsx
  - apps/dashboard/components/recommendation-action-card.tsx
  - apps/api/src/__tests__/cost-optimizer.test.ts
- **Depends on**: Per-Connector Cost Attribution & Billing Breakdown, Token Analytics Service & Dashboard
- **Added**: 2026-06-08

---

## Layer 44: Workspace Onboarding & Initial Setup

### Task: Workspace Onboarding Flow & First-Sync Guided Experience
- **Layer**: 44 — Workspace Onboarding & Initial Setup
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build an interactive onboarding wizard to guide new workspaces through their first connector setup and initial sync to reach "first meaningful context" rapidly. Create apps/dashboard/app/onboarding/page.tsx with a multi-step wizard: (1) Welcome screen (workspace name, company info), (2) Connector picker (show top 5 recommended connectors with ROI callouts, allow custom selection), (3) OAuth flow manager (handle OAuth redirects for selected connectors, display progress), (4) Schema review (auto-discovery preview, allow users to approve/customize field mappings before sync), (5) Initial sync trigger & monitoring (show real-time progress bar, entity count, preview of indexed entities), (6) Completion screen (show "X entities indexed, Y hours time saved vs manual context", link to advanced setup). Implement as guided tour with skip-to-section navigation. Create packages/semantic-core/src/onboarding-manager.ts with: trackOnboardingStage(workspaceId), getRecommendedConnectors(companySize, industry), and recordCompletionMetrics(workspaceId, connectorsAdded, entitiesIndexed, timeToFirstSync). Store onboarding progress in onboarding_sessions table (workspace_id, stage, completed_at, metrics_json). Expose GET /api/v1/onboarding/status (current stage) and POST /api/v1/onboarding/skip endpoint. Wire schema auto-discovery (from schema-discoverer.ts) to the wizard. Add email invite after completion linking to dashboard. Full unit tests with mocked API responses, E2E Playwright test covering full onboarding flow (5+ scenario tests: with/without OAuth, schema customization, sync cancellation). Reference api-conventions.md for API response patterns and code-style.md for state management.
- **Files**:
  - apps/dashboard/app/onboarding/page.tsx
  - apps/dashboard/components/onboarding-wizard.tsx
  - apps/dashboard/components/connector-picker.tsx
  - apps/dashboard/components/schema-review-step.tsx
  - apps/dashboard/components/sync-progress-monitor.tsx
  - packages/semantic-core/src/onboarding-manager.ts
  - packages/semantic-core/src/__tests__/onboarding-manager.test.ts
  - apps/api/migrations/055_add_onboarding_tracking.sql
  - apps/api/src/routes/onboarding.ts
  - apps/api/src/__tests__/onboarding.test.ts
  - tests/e2e/onboarding.spec.ts
- **Depends on**: Connector Instance Management API, Schema Auto-Discovery with Human-in-the-Loop Confirmation
- **Added**: 2026-06-08

### Task: Workspace Collaboration & Sharing Features
- **Layer**: 44 — Workspace Onboarding & Initial Setup
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement team collaboration features allowing multiple users to work together in a workspace with granular permission controls. Create apps/api/migrations/056_add_workspace_collaboration.sql with tables: workspace_members (id, workspace_id, user_id, role: 'admin'|'editor'|'viewer', invited_at, accepted_at), resource_shares (id, workspace_id, resource_type: 'connector'|'glossary'|'metric'|'workflow', resource_id, shared_with_user_id, permission: 'read'|'write'), and team_groups (id, workspace_id, group_name, member_ids_json). Create packages/semantic-core/src/collaboration-manager.ts with: inviteUser(workspaceId, email, role), updateUserRole(workspaceId, userId, newRole), shareResource(workspaceId, resourceType, resourceId, targetUserId, permission), and checkPermission(userId, resourceType, resourceId, action). Implement role-based access control (RBAC): admin can view all + manage members; editor can sync connectors + edit glossary/metrics; viewer can only read/query context. Wire permission checks into all API routes (enforce via auth middleware). Update all MCP tools to filter results by user's assigned role-based permissions. Expose GET /api/v1/workspace/members, POST /api/v1/workspace/members/invite, PUT /api/v1/workspace/members/:userId/role endpoints. Build dashboard pages: apps/dashboard/app/settings/[workspaceId]/members/page.tsx (member list, invite form, role editor), apps/dashboard/app/settings/[workspaceId]/resource-sharing/page.tsx (share controls per resource). Send invite emails with workspace setup links. Add 20+ unit tests for permission checking, role transitions, and edge cases. Integration tests verifying cross-user isolation and permission enforcement in API/MCP responses. Reference api-conventions.md for auth patterns and code-style.md for error handling.
- **Files**:
  - apps/api/migrations/056_add_workspace_collaboration.sql
  - packages/semantic-core/src/collaboration-manager.ts
  - packages/semantic-core/src/__tests__/collaboration-manager.test.ts
  - packages/semantic-core/src/__tests__/collaboration-manager.integration.test.ts
  - apps/api/src/middleware/auth.ts (update: role checking)
  - apps/api/src/routes/workspace-members.ts
  - apps/api/src/__tests__/workspace-members.test.ts
  - apps/dashboard/app/settings/[workspaceId]/members/page.tsx
  - apps/dashboard/components/member-management.tsx
  - apps/dashboard/components/invite-form.tsx
  - apps/dashboard/components/role-editor.tsx
- **Depends on**: Multi-Tenant Support & Workspace Isolation, Role-Based Context Segmentation
- **Added**: 2026-06-08

### Task: Local Development & Self-Hosted Deployment Documentation
- **Layer**: 44 — Workspace Onboarding & Initial Setup
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Create comprehensive documentation and Docker/Helm configurations enabling developers and on-prem customers to self-host Iris. Create infra/docker/docker-compose-full.yml extending the existing docker-compose.yml to include: Iris API container, MCP server container, dashboard container, Postgres, Redis, Qdrant, Jaeger (tracing), and optional external services (Stripe webhook simulator, Slack app local server). Create Helm charts in infra/helm/ for Kubernetes deployments: iris-api, iris-mcp-server, iris-dashboard charts with: configurable replicas, resource limits, health check probes, PVC for data persistence, Ingress for external access, and ConfigMap/Secret management for environment variables. Write docs/SELF_HOSTED.md covering: system requirements (CPU, RAM, disk), installation steps (clone, .env config, docker-compose/kubectl up), initial admin setup (create first workspace, configure billing if needed), monitoring setup (Prometheus scraping), SSL/TLS configuration, database backup strategy, and upgrade procedures. Create script infra/scripts/deploy.sh automating docker-compose and Helm deployments with pre-flight checks. Document troubleshooting common issues (Redis connection, Postgres migrations, DNS resolution). Add diagram explaining architecture: 3-tier app (LB → API replicas → Postgres/Redis/Qdrant), MCP server as sidecar or separate workload, dashboard as static + reverse-proxy. Include example configs for: small deployment (1 API + 1 worker, shared Redis), medium deployment (3 API replicas, separate worker, managed Postgres), and high-availability deployment (API/worker/MCP auto-scaling, external DB, object storage). Write deployment tests: shell script that spins up docker-compose, runs health checks, and validates API/MCP are operational. Add migration from cloud to self-hosted guide. Reference code-style.md for secrets handling (never commit .env files). No tests required — documentation-focused task.
- **Files**:
  - infra/docker/docker-compose-full.yml
  - infra/helm/iris-api/Chart.yaml
  - infra/helm/iris-api/values.yaml
  - infra/helm/iris-api/templates/deployment.yaml
  - infra/helm/iris-mcp-server/Chart.yaml
  - infra/helm/iris-mcp-server/values.yaml
  - infra/helm/iris-mcp-server/templates/deployment.yaml
  - infra/helm/iris-dashboard/Chart.yaml
  - infra/scripts/deploy.sh
  - docs/SELF_HOSTED.md
  - docs/DEPLOYMENT_ARCHITECTURE.md
  - docs/TROUBLESHOOTING.md
- **Depends on**: Health & Readiness Endpoints + Graceful Shutdown, Observability & Distributed Tracing Infrastructure
- **Added**: 2026-06-08

### Task: Admin Dashboard Pages & System Monitoring Suite
- **Layer**: 44 — Workspace Onboarding & Initial Setup
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build comprehensive admin dashboard pages for system-level monitoring and workspace management. Create new dashboard pages under apps/dashboard/app/admin/: (1) /admin/overview - system health dashboard (API uptime, DB health, Redis status, queue depth, error rate sparklines), (2) /admin/workspaces - workspace management (list all workspaces, search by name/owner, bulk actions, disable/delete with confirmation), (3) /admin/users - user management (list users, search, disable accounts, view last login), (4) /admin/performance - performance profiling (query latency distribution, connector sync timing, cache hit rates by endpoint), (5) /admin/logs - real-time log viewer (filter by service/level/keyword, search correlation IDs), (6) /admin/billing - billing dashboard (MRR, customer breakdown, failed payment alerts, refund form). Create supporting components: WorkspaceManagementPanel, UserManagementPanel, PerformanceProfiler (charts via Recharts), LogViewer (virtualized list for 100K+ logs), BillingMetrics. Implement backend: GET /api/v1/admin/system-health (health check aggregator), GET /api/v1/admin/workspaces (workspace list with stats), GET /api/v1/admin/logs (paginated log search), GET /api/v1/admin/performance/summary (aggregated metrics). Use Redis for rate limiting queries (prevent log queries from overloading DB). Add audit logging for all admin actions (workspace suspension, user disable, etc.). Full unit tests for components and API endpoints (mocked data), integration tests verifying admin-only access (non-admin gets 403). Reference api-conventions.md for REST patterns and code-style.md for error handling.
- **Files**:
  - apps/dashboard/app/admin/overview/page.tsx
  - apps/dashboard/app/admin/workspaces/page.tsx
  - apps/dashboard/app/admin/users/page.tsx
  - apps/dashboard/app/admin/performance/page.tsx
  - apps/dashboard/app/admin/logs/page.tsx
  - apps/dashboard/app/admin/billing/page.tsx
  - apps/dashboard/components/workspace-management-panel.tsx
  - apps/dashboard/components/user-management-panel.tsx
  - apps/dashboard/components/real-time-log-viewer.tsx
  - apps/dashboard/components/performance-summary-charts.tsx
  - apps/api/src/routes/admin-system.ts
  - apps/api/src/__tests__/admin-system.test.ts
  - apps/dashboard/app/admin/__tests__/overview.test.tsx
- **Depends on**: Comprehensive Audit Trail & Log Viewer, Token Analytics Service & Dashboard, Health & Readiness Endpoints + Graceful Shutdown
- **Added**: 2026-06-08

---

## Layer 45: Document Indexing & Search Tuning

### Task: Native Document Indexing from Connector Sources
- **Layer**: 45 — Document Indexing & Search Tuning
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Extend connectors to extract and index full-text content from document-based sources (Google Drive PDFs, Notion page content, Confluence articles, GitHub README files). Create packages/semantic-core/src/document-indexer.ts with DocumentIndexer class: (1) extractTextFromPDF(buffer) using pdfjs-dist library, (2) extractTextFromDocx(buffer) using docx library, (3) createFullTextIndex for indexing extracted content into a separate documents table (workspace_id, source_connector_id, source_entity_id, document_title, document_content_plaintext, content_hash, extracted_at). Implement a hybrid entity representation: SemanticEntity with both structured attributes AND linked full-text documents. Update retrieval engine to: (1) on query, search both entity attributes AND document full-text, (2) return documents with highlighted excerpts showing context around search keywords, (3) merge document results with entity results ranked by relevance. Add per-connector toggle "Extract Document Content" (default: false for cost control). Wire full-text search into MCP tool query-context to support queries like "find all customer agreements mentioning 'payment terms'" returning matching excerpts. Build dashboard admin panel at apps/dashboard/components/document-indexing-config.tsx showing: indexing status per connector, document count per type, cost per GB of content indexed. Add unit tests (20+) with mock PDFs/docx files, integration tests with real files. Reference embedding-patterns.md for token cost budgeting (full-text indexing can consume 10–100× more tokens than entity-only).
- **Files**:
  - packages/semantic-core/src/document-indexer.ts
  - packages/semantic-core/src/__tests__/document-indexer.test.ts
  - packages/semantic-core/src/__tests__/document-indexer.integration.test.ts
  - apps/api/migrations/058_add_document_storage.sql
  - apps/api/src/routes/document-indexing.ts
  - apps/dashboard/components/document-indexing-config.tsx
  - packages/connectors/google-drive/src/document-handler.ts (update)
  - packages/connectors/notion/src/document-handler.ts (update)
  - apps/api/src/__tests__/document-indexing.test.ts
- **Depends on**: Indexer Implementation, Full Response-Level Caching for MCP Tools
- **Added**: 2026-06-08

### Task: Search Relevance Tuning & Scoring UI
- **Layer**: 45 — Document Indexing & Search Tuning
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a user-facing tool for tuning search relevance scoring to improve query results for business-specific needs. Create packages/semantic-core/src/relevance-tuner.ts with RelevanceTuner class: (1) define scoring factors (BM25 for full-text, cosine similarity for embeddings, entity type match, relationship distance, freshness/recency boost, custom business rules), (2) allow admins to configure weights per workspace (e.g., boost recent contacts, boost high-value accounts), (3) train on labeled query-result pairs via click-through data (users clicking results = positive signal). Expose POST /api/v1/search-tuning/feedback endpoint to record user interactions (query, clicked result rank, dwell time). Store feedback in search_feedback table (workspace_id, query, clicked_entity_id, rank, feedback_score, timestamp). Implement learning: aggregate feedback into search_tuning_config table (workspace_id, factor_name: 'bm25_weight'|'embedding_weight'|'type_boost_contact', tuned_value). Build dashboard page at apps/dashboard/app/search-tuning/page.tsx with: (1) Test Search section (query box, results preview), (2) Tuning Controls (sliders for each factor weight, A/B test toggle), (3) Feedback Analytics (click-through rates per query, factor impact visualization), (4) Learning Status (model training progress if using ML-based tuning). Add validation: prevent tuning weights that would invert result quality (automatic rollback if metrics degrade). Include 15+ unit tests for scoring calculations, 10+ integration tests with real feedback data. Reference embedding-patterns.md for threshold tuning patterns.
- **Files**:
  - packages/semantic-core/src/relevance-tuner.ts
  - packages/semantic-core/src/__tests__/relevance-tuner.test.ts
  - packages/semantic-core/src/__tests__/relevance-tuner.integration.test.ts
  - apps/api/migrations/059_add_search_tuning.sql
  - apps/api/src/routes/search-tuning.ts
  - apps/dashboard/app/search-tuning/page.tsx
  - apps/dashboard/components/relevance-factor-control.tsx
  - apps/dashboard/components/search-results-preview.tsx
  - apps/dashboard/components/tuning-feedback-analytics.tsx
  - apps/api/src/__tests__/search-tuning.test.ts
- **Depends on**: Query Decomposition & Entity Type Detection, Advanced Index Optimization & Query Performance
- **Added**: 2026-06-08

### Task: Connector Template & Workflow Recipe System
- **Layer**: 45 — Document Indexing & Search Tuning
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a system for creating and sharing reusable connector configuration templates and workflow recipes tailored to specific business use cases. Create packages/semantic-core/src/connector-recipes.ts with ConnectorRecipeManager class supporting: (1) predefined recipes (e.g., "Sales Operations Setup" = HubSpot + Salesforce + Stripe, with field mappings configured), (2) custom recipe creation by users (combine connectors, define glossary terms, set up workflows), (3) recipe versioning and sharing across workspaces. Create apps/api/migrations/060_add_connector_recipes.sql with: connector_recipes table (id, workspace_id, recipe_name, description, connectors_config_json, glossary_terms_json, workflows_json, author_user_id, shared: boolean, usage_count), recipe_reviews table (recipe_id, reviewer_id, rating, comment). Expose: POST /api/v1/recipes/templates (create template), GET /api/v1/recipes/shared (list community recipes), POST /api/v1/recipes/:id/apply-to-workspace (fork recipe and apply). Build marketplace-style discovery page at apps/dashboard/app/recipes/page.tsx showing: recipe gallery (category filters: sales, finance, ops, etc.), install buttons, ratings/reviews, preview (shows connectors + glossary snapshot). Enable recipe cloning: POST /api/v1/recipes/:id/clone creates copy in user's workspace with all configs applied. Store recipes as JSON-serializable YAML or JSON files enabling export/GitHub sharing. Add E2E test covering: recipe creation → sharing → installation in another workspace. Include 12+ unit tests for recipe application logic. Reference connector-patterns.md for connector configuration semantics.
- **Files**:
  - packages/semantic-core/src/connector-recipes.ts
  - packages/semantic-core/src/__tests__/connector-recipes.test.ts
  - apps/api/migrations/060_add_connector_recipes.sql
  - apps/api/src/routes/connector-recipes.ts
  - apps/dashboard/app/recipes/page.tsx
  - apps/dashboard/components/recipe-gallery.tsx
  - apps/dashboard/components/recipe-installer.tsx
  - apps/dashboard/components/recipe-editor.tsx
  - apps/api/src/__tests__/connector-recipes.test.ts
  - tests/e2e/connector-recipes.spec.ts
- **Depends on**: Connector Instance Management API, Workflow Templates API Routes & Server Registration
- **Added**: 2026-06-08

### Task: Cost-Per-Context Analytics & Optimization Recommendations
- **Layer**: 45 — Document Indexing & Search Tuning
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement fine-grained cost attribution and automatic optimization recommendations to help teams reduce AI context costs. Extend packages/semantic-core/src/cost-optimizer.ts (already committed) with: (1) trackContextSize(query, entities, tokensSpent, tokensSaved) recording actual costs per query context, (2) attributeCosts(workspaceId, timeframe) breaking down costs by: source connector (which connectors contribute to context cost), entity type (which entity types consume tokens), query patterns (which question types are expensive). Create apps/api/migrations/061_add_context_cost_tracking.sql with: context_cost_events table (workspace_id, query_hash, entities_returned, tokens_spent, cache_hit, source_connectors, entity_types, timestamp). Implement CostOptimizer.recommend(workspaceId) analyzing patterns and returning: (1) "Disable connector X (1% of queries, 8% of cost)" — suggest archiving low-value connectors, (2) "Index only top 3 fields per entity instead of all" — suggest schema field pruning, (3) "Enable compression for query pattern Y" — suggest selective compression for verbose entity types. Expose GET /api/v1/cost-analytics/breakdown returning cost by connector/type/pattern with trend analysis (week-over-week cost changes). Build admin dashboard panel at apps/dashboard/components/cost-optimization-advisor.tsx showing: pie chart of cost by connector, ranked recommendations with estimated savings (cost reduction %), one-click "apply recommendation" action (e.g., disable connector, update schema). Add automated alerts: warn if week-over-week cost increases >20%. Include 18+ unit tests for cost calculations and recommendation logic, integration tests with real usage data. Reference embedding-patterns.md for cost control rules.
- **Files**:
  - packages/semantic-core/src/cost-optimizer.ts (update existing)
  - packages/semantic-core/src/__tests__/cost-optimizer.test.ts (update)
  - apps/api/migrations/061_add_context_cost_tracking.sql
  - apps/api/src/routes/cost-analytics.ts
  - apps/dashboard/components/cost-optimization-advisor.tsx
  - apps/dashboard/components/cost-breakdown-chart.tsx
  - apps/dashboard/components/recommendation-card.tsx
  - apps/api/src/__tests__/cost-analytics.test.ts
- **Depends on**: Usage-Based Billing & Metering Infrastructure, Token Analytics Service & Dashboard
- **Added**: 2026-06-08

---

## Layer 46: Connector Recipes & Index Maintenance

### Task: Connector Recipe System Implementation
- **Layer**: 46 — Connector Recipes & Index Maintenance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete the Connector Recipe System started in Layer 45 (migration 060 already exists). Create packages/semantic-core/src/connector-recipes.ts with ConnectorRecipeManager class supporting: (1) loadPredefinedRecipes() returning curated templates (e.g., "Sales Operations Setup" = HubSpot + Salesforce + Stripe), (2) createRecipe(workspaceId, name, description, connectorsConfig, glossaryTerms, workflows) for user-created recipes, (3) shareRecipe(recipeId, isPublic) and listSharedRecipes(filters) for marketplace discovery, (4) applyRecipeToWorkspace(workspaceId, recipeId) cloning and installing all connectors/glossary/workflows. Implement versioning and fork semantics. Expose REST routes in apps/api/src/routes/connector-recipes.ts: POST /api/v1/recipes (create), GET /api/v1/recipes (list user recipes), GET /api/v1/recipes/templates (list public templates), POST /api/v1/recipes/:id/apply (apply to workspace), PUT /api/v1/recipes/:id (update), DELETE /api/v1/recipes/:id (delete). Build dashboard pages: apps/dashboard/app/recipes/page.tsx (discovery gallery with category filters, install buttons, ratings), apps/dashboard/app/recipes/[id]/preview/page.tsx (recipe details: connectors, glossary snapshot, workflow diagram), apps/dashboard/components/recipe-installer.tsx (multi-step installer). Implement recipe export as YAML for GitHub sharing. Add E2E test: recipe creation → sharing → installation in another workspace. Include 15+ unit tests for recipe application logic, connector config merging, glossary term application. Reference connector-patterns.md for connector configuration semantics and api-conventions.md for REST endpoints.
- **Files**:
  - packages/semantic-core/src/connector-recipes.ts
  - packages/semantic-core/src/__tests__/connector-recipes.test.ts
  - packages/semantic-core/src/__tests__/connector-recipes.integration.test.ts
  - apps/api/src/routes/connector-recipes.ts
  - apps/api/src/__tests__/connector-recipes.test.ts
  - apps/dashboard/app/recipes/page.tsx
  - apps/dashboard/app/recipes/[id]/preview/page.tsx
  - apps/dashboard/components/recipe-installer.tsx
  - apps/dashboard/components/recipe-gallery.tsx
  - apps/dashboard/components/recipe-editor.tsx
  - tests/e2e/connector-recipes.spec.ts
- **Depends on**: Connector Instance Management API, Workflow Templates API Routes & Server Registration
- **Added**: 2026-06-08

### Task: Index Health & Automated Maintenance Jobs
- **Layer**: 46 — Connector Recipes & Index Maintenance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement automated background maintenance for the semantic index to ensure data quality and storage efficiency. Create packages/semantic-core/src/index-maintenance.ts with IndexMaintenanceService class supporting: (1) deduplicateIndex(workspaceId) running nightly to merge semantically similar entities (0.92 threshold) and consolidate duplicate entries, (2) pruneStaleEntities(workspaceId, maxAgeDays) removing indexed entities not updated in N days (default: 90), (3) rebalanceVectorIndex(workspaceId) triggering pgvector or Qdrant rebalancing for query performance, (4) validateIndexIntegrity(workspaceId) checking for orphaned entities, broken relationships, and corrupted embeddings. Create apps/api/migrations/062_add_index_maintenance_jobs.sql with: index_maintenance_jobs table (workspace_id, job_type, status, started_at, completed_at, duration_ms, records_affected, error_message) for audit trail. Implement job scheduling via BullMQ: daily dedup at 2am, weekly pruning at Sunday 3am, monthly rebalancing at first Saturday. Expose admin endpoints: GET /api/v1/admin/index/maintenance (list jobs), POST /api/v1/admin/index/maintenance/:jobType/trigger (manual run), GET /api/v1/admin/index/health (current index stats: entity count, vector store size, orphaned entities count). Build admin dashboard panel at apps/dashboard/components/index-optimizer-panel.tsx showing: job history (status badges, duration, records affected), manual trigger buttons, health summary. Add unit tests (18+) for dedup/prune logic with mock data, integration tests with real Postgres/Qdrant. Reference testing.md for integration test patterns.
- **Files**:
  - packages/semantic-core/src/index-maintenance.ts
  - packages/semantic-core/src/__tests__/index-maintenance.test.ts
  - packages/semantic-core/src/__tests__/index-maintenance.integration.test.ts
  - apps/api/migrations/062_add_index_maintenance_jobs.sql
  - apps/api/src/routes/admin-index.ts
  - apps/api/src/__tests__/admin-index.test.ts
  - apps/dashboard/components/index-optimizer-panel.tsx
  - apps/dashboard/app/admin/index-health/page.tsx
- **Depends on**: BullMQ Job Queue Infrastructure, Indexer Implementation, Vector Store Interface
- **Added**: 2026-06-08

### Task: Advanced MCP Notifications & Change Subscriptions
- **Layer**: 46 — Connector Recipes & Index Maintenance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the MCP server to support real-time notifications and subscriptions so clients can subscribe to index changes (new entities, relationship updates, metric refreshes). Create packages/semantic-core/src/mcp-subscriptions.ts with MCPSubscriptionManager class: (1) subscribe(client_id, filters) where filters include entity_types, connectors, keywords to track, (2) unsubscribe(client_id, subscription_id), (3) notifyClients(change_event) broadcasting changes to all subscribed clients when entities are added/updated. Implement MCP resource notifications (RFC): define a new MCP message type: NotificationEvent { type: 'entity.created'|'entity.updated'|'entity.deleted', entity: SemanticEntity, timestamp, workspaceId }. Wire into the indexer: on flushBatch completion, emit notifications to all subscribed clients matching filters. Create apps/api/migrations/063_add_mcp_subscriptions.sql with: mcp_subscriptions table (id, workspace_id, client_id, filters_json, created_at, last_notified_at) and mcp_notification_events table (event_id, subscription_id, notification_type, entity_id, payload_json, delivered_at). Expose POST /api/v1/mcp/subscribe and DELETE /api/v1/mcp/subscriptions/:id endpoints for REST-based subscription management. Add support for webhook-style notifications: on subscription, clients can specify a callback_url to receive POST requests with change events. Include 12+ unit tests for subscription matching and event filtering, integration tests verifying notifications are delivered. Reference api-conventions.md for REST patterns and .claude/rules/code-style.md for async patterns.
- **Files**:
  - packages/semantic-core/src/mcp-subscriptions.ts
  - packages/semantic-core/src/__tests__/mcp-subscriptions.test.ts
  - packages/semantic-core/src/__tests__/mcp-subscriptions.integration.test.ts
  - apps/api/migrations/063_add_mcp_subscriptions.sql
  - apps/api/src/routes/mcp-subscriptions.ts
  - apps/api/src/__tests__/mcp-subscriptions.test.ts
  - apps/mcp-server/src/subscription-manager.ts
  - apps/mcp-server/src/__tests__/subscription-manager.test.ts
- **Depends on**: MCP Server Bootstrap, Semantic Cache, BullMQ Job Queue Infrastructure
- **Added**: 2026-06-08

### Task: Index Composition Analytics & Insights Dashboard
- **Layer**: 46 — Connector Recipes & Index Maintenance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build comprehensive analytics showing index composition, data freshness, entity quality metrics, and optimization opportunities. Create packages/semantic-core/src/index-analytics.ts with IndexAnalyticsService class: (1) getCompositionMetrics(workspaceId) returning entity count/type breakdown, storage distribution (entities vs documents), top sources (which connectors contribute most), (2) getFreshnessMetrics(workspaceId) showing avg age per entity type, last sync time per connector, % of entities updated in last 7/30 days, (3) getQualityMetrics(workspaceId) including: % entities with relationships, avg relationship density, dedup ratios (duplicates found/merged), embedding coverage (% of entities embedded), (4) getOptimizationOpportunities(workspaceId) suggesting: "Entity type X has 5000 duplicates (cost $50/month)" or "Document connector Y unused for 60 days (archive to save storage)". Expose GET /api/v1/analytics/index returning time-series and breakdowns. Create apps/api/migrations/064_add_index_composition_tracking.sql with: index_composition_snapshots table (workspace_id, snapshot_date, entity_types_json, connector_contributions_json, freshness_metrics_json) for trend analysis. Build dashboard page at apps/dashboard/app/analytics/[workspaceId]/composition/page.tsx with: (1) Composition Charts — donut chart of entities by type, stacked bar of storage by source, (2) Freshness Timeline — line chart showing % entities updated over time, (3) Quality Scorecard — entity quality metrics with trend indicators, (4) Optimization Recommendations — ranked list with "archive connector" or "run dedup" actions. Add 14+ unit tests for analytics calculations, 8+ integration tests with synthetic data. Reference code-style.md for structured logging of analytics computations.
- **Files**:
  - packages/semantic-core/src/index-analytics.ts
  - packages/semantic-core/src/__tests__/index-analytics.test.ts
  - packages/semantic-core/src/__tests__/index-analytics.integration.test.ts
  - apps/api/migrations/064_add_index_composition_tracking.sql
  - apps/api/src/routes/index-composition.ts
  - apps/api/src/__tests__/index-composition.test.ts
  - apps/dashboard/app/analytics/[workspaceId]/composition/page.tsx
  - apps/dashboard/components/composition-charts.tsx
  - apps/dashboard/components/freshness-timeline.tsx
  - apps/dashboard/components/quality-scorecard.tsx
- **Depends on**: Index Status & Coverage Metrics, Token Analytics Service & Dashboard
- **Added**: 2026-06-08

---

## Layer 47: Enterprise Search & Advanced AI Integration

### Task: Hybrid Semantic + Full-Text Search Engine with Advanced Filtering
- **Layer**: 47 — Enterprise Search & Advanced AI Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build an enterprise-grade search engine combining semantic vector search, BM25 full-text search, and structured filtering for power users and integrations. Create packages/semantic-core/src/hybrid-search-engine.ts with HybridSearchEngine class implementing: (1) reciprocal rank fusion (RRF) combining BM25 and cosine similarity scores with configurable weights, (2) structured faceted filters (entity_type, source_connector, date_range, status, custom attributes), (3) advanced query syntax (quoted phrases, field-specific "field:value" searches, boolean operators), (4) query spell-checking and suggestions using Levenshtein distance, (5) search result clustering by entity type/source. Expose POST /api/v1/search endpoint accepting: {query, filters, limit, offset, include_suggestions, explain_scoring} returning ranked results with relevance explanations. Update MCP tool query-context to use hybrid search for better precision. Build dashboard search interface at apps/dashboard/app/search/page.tsx with: query builder UI, faceted filters, result highlighting, search history, saved searches. Add 25+ unit tests for RRF scoring, filter logic, and query parsing. Reference embedding-patterns.md for threshold patterns.
- **Files**:
  - packages/semantic-core/src/hybrid-search-engine.ts
  - packages/semantic-core/src/__tests__/hybrid-search-engine.test.ts
  - packages/semantic-core/src/__tests__/hybrid-search-engine.integration.test.ts
  - apps/api/src/routes/search.ts
  - apps/dashboard/app/search/page.tsx
  - apps/dashboard/components/search-query-builder.tsx
  - apps/dashboard/components/faceted-filter-sidebar.tsx
  - apps/dashboard/components/search-result-item.tsx
  - apps/api/src/__tests__/search.test.ts
- **Depends on**: Connector Template & Workflow Recipe System, Search Relevance Tuning & Scoring UI
- **Added**: 2026-06-08

### Task: Streaming Context Response API for Real-Time Agent Integration
- **Layer**: 47 — Enterprise Search & Advanced AI Integration
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement streaming context responses via Server-Sent Events (SSE) and WebSocket to support real-time AI agent integrations where context is progressively retrieved and prioritized. Create apps/api/src/routes/streaming-context.ts with: (1) POST /api/v1/context/stream endpoint accepting a query and streaming JSON chunks (one entity per line, with relevance rank and token count), (2) progressive refinement where high-confidence results stream first, followed by lower-confidence suggestions, (3) client-side cancellation via request abort signal, (4) per-result token budget enforcement. Implement WebSocket version at /ws/context-stream for long-lived agent connections. Update MCP server to support streaming responses for multi-turn conversations. Build dashboard page at apps/dashboard/app/context-monitor/page.tsx showing: live streaming context previews, streaming latency metrics (time to first result, full context time), token efficiency analytics. Add 15+ unit tests for streaming logic, integration tests with real queries, E2E tests simulating agent consumption. Reference api-conventions.md for request patterns.
- **Files**:
  - apps/api/src/routes/streaming-context.ts
  - apps/api/src/websocket/context-stream-handler.ts
  - apps/api/src/__tests__/streaming-context.test.ts
  - apps/api/src/__tests__/streaming-context.integration.test.ts
  - apps/dashboard/app/context-monitor/page.tsx
  - apps/dashboard/components/streaming-preview-panel.tsx
  - apps/dashboard/components/streaming-metrics-chart.tsx
  - tests/e2e/streaming-context.spec.ts
- **Depends on**: Hybrid Semantic + Full-Text Search Engine with Advanced Filtering
- **Added**: 2026-06-08

### Task: AI-Assisted Index Auto-Tuning with Self-Learning Recommendations
- **Layer**: 47 — Enterprise Search & Advanced AI Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement an intelligent optimization engine that analyzes query patterns, entity usage, and search quality metrics to automatically generate performance tuning recommendations. Create packages/semantic-core/src/auto-tuning-optimizer.ts with AutoTuningOptimizer class: (1) analyze query logs to identify frequently-asked questions and rarely-used entity types, (2) detect search quality issues (zero-result queries, high bounce rates, low CTR), (3) generate recommendations: "split entity type X into subtypes A/B/C for precision", "merge rarely-used types to reduce noise", "boost freshness for time-sensitive types", "disable embedding indexing for high-cardinality fields to save cost", (4) apply via A/B test framework (10% of workspaces, measure quality/cost impact, auto-rollback if metrics degrade), (5) learn from user feedback (mark recommendations helpful/unhelpful to improve future suggestions). Expose GET /api/v1/optimization/recommendations (list pending recommendations with cost impact estimates), POST /api/v1/optimization/recommendations/:id/apply-test (activate A/B test). Build admin panel at apps/dashboard/components/auto-tuning-advisor.tsx showing: pending recommendations with estimated savings, active tests and outcomes, learning progress. Add 18+ unit tests for recommendation logic, integration tests with synthetic query logs. Reference code-style.md for error handling.
- **Files**:
  - packages/semantic-core/src/auto-tuning-optimizer.ts
  - packages/semantic-core/src/__tests__/auto-tuning-optimizer.test.ts
  - packages/semantic-core/src/__tests__/auto-tuning-optimizer.integration.test.ts
  - apps/api/migrations/065_add_auto_tuning_config.sql
  - apps/api/src/routes/auto-tuning.ts
  - apps/dashboard/components/auto-tuning-advisor.tsx
  - apps/dashboard/components/ab-test-results-panel.tsx
  - apps/api/src/__tests__/auto-tuning.test.ts
- **Depends on**: Search Relevance Tuning & Scoring UI, Cost-Per-Context Analytics & Optimization Recommendations
- **Added**: 2026-06-08

### Task: Multi-LLM Provider Support with Model-Specific Optimizations
- **Layer**: 47 — Enterprise Search & Advanced AI Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend Iris to support multiple LLM providers beyond OpenAI (Claude, Gemini, Llama, Mistral, etc.) with automatic context optimization per provider's capabilities. Create packages/semantic-core/src/multi-provider-optimizer.ts implementing: (1) provider registry with name, token limits, context window, pricing, serialization preference, streaming support, prefix cache support, (2) dynamically select embedding model per provider (OpenAI for OpenAI, Google models for Gemini, open-source for Ollama), (3) optimize context format per provider (Claude prefers specific JSON, Gemini prefers XML-like), (4) cost estimation per provider for a query/context, (5) provider-specific token counting. Update apps/api/src/routes/billing.ts to show cost breakdown by provider. Build admin panel at apps/dashboard/components/provider-config.tsx allowing: setup multiple providers, set fallback ordering, configure provider access per workspace, view cost comparisons for sample queries. Add 16+ unit tests for cost calculations and provider logic, 8+ integration tests with mock APIs. Reference embedding-patterns.md for multi-model best practices.
- **Files**:
  - packages/semantic-core/src/multi-provider-optimizer.ts
  - packages/semantic-core/src/providers/provider-registry.ts
  - packages/semantic-core/src/__tests__/multi-provider-optimizer.test.ts
  - apps/api/migrations/065_add_provider_config.sql
  - apps/api/src/routes/providers.ts
  - apps/dashboard/components/provider-config.tsx
  - apps/dashboard/components/provider-cost-comparison.tsx
  - apps/api/src/__tests__/providers.test.ts
- **Depends on**: Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-08

### Task: Compliance & Audit Reporting Suite for Regulated Industries
- **Layer**: 47 — Enterprise Search & Advanced AI Integration
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build compliance and audit reporting for regulated industries (HIPAA, SOC2, GDPR, CCPA). Create packages/semantic-core/src/compliance-reporter.ts with ComplianceReporter class: (1) track all data access via audit logs (who, what, when, from which tool, what context), (2) detect anomalous patterns (unusual access time, geographic anomaly, bulk exports), (3) generate compliance reports per framework (HIPAA access logs for PII, GDPR data subject access requests, SOC2 change logs, CCPA deletion verification), (4) support data retention policies (auto-purge old data per regulation), (5) PII field tagging and access tracking. Create apps/api/migrations/065_add_compliance_tracking.sql with: compliance_events table (workspace_id, event_type: access|export|delete, entity_id, accessed_fields, user, timestamp, ip_address, device_info), anomaly_alerts table. Expose: GET /api/v1/compliance/report/{framework} (generate report), POST /api/v1/compliance/dsr (data subject request), GET /api/v1/compliance/audit-log (searchable audit trail). Build admin page at apps/dashboard/app/admin/compliance/page.tsx with: compliance status, audit log viewer, anomaly alerts, report generator. Add 16+ unit tests for compliance logic and reporting, integration tests with GDPR sample data. Reference code-style.md for logging.
- **Files**:
  - packages/semantic-core/src/compliance-reporter.ts
  - packages/semantic-core/src/__tests__/compliance-reporter.test.ts
  - packages/semantic-core/src/__tests__/compliance-reporter.integration.test.ts
  - apps/api/migrations/065_add_compliance_tracking.sql
  - apps/api/src/routes/compliance.ts
  - apps/dashboard/app/admin/compliance/page.tsx
  - apps/dashboard/components/compliance-status-panel.tsx
  - apps/dashboard/components/audit-log-explorer.tsx
  - apps/dashboard/components/anomaly-alert-dashboard.tsx
  - apps/api/src/__tests__/compliance.test.ts
- **Depends on**: MCP Server API Key Authentication & Workspace Isolation, Fine-Grained PII & Sensitive Field Masking
- **Added**: 2026-06-08

---

## Layer 48: Real-Time Updates & Advanced Data Governance

### Task: Real-Time Entity Updates via WebSocket Subscriptions
- **Layer**: 48 — Real-Time Updates & Advanced Data Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement WebSocket-based real-time entity subscription system to push live updates to dashboard clients whenever entities are indexed or modified. Create apps/api/src/websocket/entity-subscriptions.ts with EntitySubscriptionManager handling: (1) client subscriptions by entity ID or entity type (e.g., subscribe to all 'contact' entities), (2) broadcast updates when indexer persists changes to vector store, (3) optional filtering by workspace_id to prevent cross-workspace leaks, (4) heartbeat pings to detect stale connections. Update apps/mcp-server/src/server.ts to emit subscription events when entities are indexed. Build WebSocket endpoint at /ws/entities that accepts JSON subscribe/unsubscribe messages. Add dashboard hook at apps/dashboard/lib/use-entity-subscription.ts that manages subscriptions and optimistic updates. Update entity list pages (apps/dashboard/app/entities/page.tsx, connectors page, graph page) to use real-time subscriptions for live entity counts, status, and relationship changes. Add 14+ unit tests for subscription logic and connection management, integration tests with real WebSocket connections, E2E test verifying live updates on dashboard. Reference api-conventions.md for WebSocket patterns.
- **Files**:
  - apps/api/src/websocket/entity-subscriptions.ts
  - apps/api/src/websocket/__tests__/entity-subscriptions.test.ts
  - apps/api/src/server.ts (update WebSocket registration)
  - apps/dashboard/lib/use-entity-subscription.ts
  - apps/dashboard/app/entities/page.tsx (update)
  - apps/dashboard/app/connectors/page.tsx (update)
  - tests/e2e/real-time-updates.spec.ts
  - packages/semantic-core/src/indexer.ts (update to emit events)
- **Depends on**: Hybrid Semantic + Full-Text Search Engine with Advanced Filtering
- **Added**: 2026-06-08

### Task: Data Lineage & Impact Analysis Engine
- **Layer**: 48 — Real-Time Updates & Advanced Data Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a data lineage tracking system that traces entity data flow from source connectors through transformations and relationships, enabling impact analysis when data changes. Create packages/semantic-core/src/data-lineage.ts with DataLineageService: (1) track entity provenance (source connector, sync timestamp, source record ID), (2) model relationship dependencies (entityA references entityB, entityB's change impacts entityA), (3) compute impact scope (given entity X changed, what other entities are affected?), (4) build lineage graph (parents/ancestors and children/descendants up to depth N). Add apps/api/migrations/067_add_lineage_tables.sql with tables: entity_lineage (entity_id, source_connector, source_record_id, last_modified_at, sync_run_id), entity_dependencies (entity_id, depends_on_entity_id, relationship_type, confidence). Expose GET /api/v1/lineage/:entityId (fetch lineage for entity), POST /api/v1/lineage/:entityId/impact-analysis (compute change impact). Build dashboard page at apps/dashboard/app/data-lineage/page.tsx with: interactive lineage graph (upstream/downstream), impact analysis tool (select entity, see affected entities), sync history timeline. Add 18+ unit tests for graph traversal and impact computation, integration tests with synthetic lineage fixtures. Reference code-style.md for error handling.
- **Files**:
  - packages/semantic-core/src/data-lineage.ts
  - packages/semantic-core/src/__tests__/data-lineage.test.ts
  - packages/semantic-core/src/__tests__/data-lineage.integration.test.ts
  - apps/api/migrations/067_add_lineage_tables.sql
  - apps/api/src/routes/lineage.ts
  - apps/dashboard/app/data-lineage/page.tsx
  - apps/dashboard/components/lineage-graph-viewer.tsx
  - apps/dashboard/components/impact-analysis-tool.tsx
  - apps/api/src/__tests__/lineage.test.ts
- **Depends on**: Entity Relationship Indexing, Knowledge Graph Service (Neo4j)
- **Added**: 2026-06-08

### Task: Entity Deduplication Review Workflow & Manual Reconciliation UI
- **Layer**: 48 — Real-Time Updates & Advanced Data Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a comprehensive entity deduplication workflow with UI for users to review and manually reconcile duplicate entities detected by the semantic deduplication engine. Create packages/semantic-core/src/dedup-reconciliation.ts with DedupReconciliationService: (1) maintain dedup_candidates table (source_entity_id, candidate_duplicate_id, similarity_score, detection_timestamp, reviewed, decision), (2) generate dedup batches (group candidates by threshold for efficient review), (3) track reconciliation decisions (merge, keep-separate, ignore). Build comprehensive dashboard page at apps/dashboard/app/admin/dedup/page.tsx with: (1) candidate list showing entity pairs with similarity scores and side-by-side preview, (2) bulk review interface (approve, reject, keep-separate buttons), (3) merge action that combines entities (update relationships, redirect old ID to new), (4) undo capability (restore merged entities within 30 days), (5) metrics dashboard (dedup rate, merge success rate, manual review backlog). Create modal components: EntityPairComparison (shows attributes diff), MergePreview (preview of merged entity), DecisionHistory (audit trail). Add API endpoints: GET /api/v1/dedup/candidates (paginated list), POST /api/v1/dedup/candidates/:sourceId/:dupId/decide (submit decision), POST /api/v1/dedup/merge (execute merge). Add 16+ unit tests for reconciliation logic, integration tests with dedup candidate fixtures, E2E test verifying full merge workflow including undo. Reference embedding-patterns.md for dedup threshold notes.
- **Files**:
  - packages/semantic-core/src/dedup-reconciliation.ts
  - packages/semantic-core/src/__tests__/dedup-reconciliation.test.ts
  - packages/semantic-core/src/__tests__/dedup-reconciliation.integration.test.ts
  - apps/api/migrations/068_add_dedup_reconciliation.sql
  - apps/api/src/routes/dedup-reconciliation.ts
  - apps/dashboard/app/admin/dedup/page.tsx (update with comprehensive UI)
  - apps/dashboard/components/entity-pair-comparison.tsx
  - apps/dashboard/components/merge-preview.tsx
  - apps/dashboard/components/dedup-decision-history.tsx
  - apps/api/src/__tests__/dedup-reconciliation.test.ts
- **Depends on**: Advanced Entity Deduplication with Rule-Based Matching
- **Added**: 2026-06-08

### Task: Custom Metrics Builder & Formula Engine with UI
- **Layer**: 48 — Real-Time Updates & Advanced Data Governance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable business users to define custom metrics via a no-code formula builder UI, supporting arithmetic operations, aggregations, and entity references. Extend packages/semantic-core/src/metrics.ts with MetricFormulaEngine: (1) parse metric formulas (e.g., "SUM(revenue) / COUNT(customers)"), (2) resolve entity type references dynamically, (3) evaluate formulas at query time against indexed data, (4) cache formula results with TTL. Update apps/api/src/routes/metrics.ts to add: POST /api/v1/metrics/:id/evaluate (compute metric value for workspace), GET /api/v1/metrics/available (list all metrics with descriptions). Build comprehensive dashboard at apps/dashboard/app/workspace/[workspaceId]/metrics/builder/page.tsx with: (1) formula editor with syntax highlighting and validation, (2) drag-and-drop metric builder (select entities, pick aggregation, set filters), (3) preview panel showing formula + sample result, (4) test data input for validation before save, (5) metric history (versions, rollback), (6) usage analytics (how often metric is queried). Create components: MetricFormulaEditor (syntax highlighting, validation), MetricDragDropBuilder (visual formula construction), MetricPreview, MetricTestPanel. Add 20+ unit tests for formula parsing and evaluation, integration tests with sample metrics and data. Reference code-style.md for validation patterns.
- **Files**:
  - packages/semantic-core/src/metrics.ts (update FormulaEngine)
  - packages/semantic-core/src/__tests__/metrics.test.ts (update)
  - apps/api/src/routes/metrics.ts (update)
  - apps/dashboard/app/workspace/[workspaceId]/metrics/builder/page.tsx
  - apps/dashboard/components/metric-formula-editor.tsx
  - apps/dashboard/components/metric-drag-drop-builder.tsx
  - apps/dashboard/components/metric-preview.tsx
  - apps/dashboard/components/metric-test-panel.tsx
  - apps/api/src/__tests__/metrics.test.ts (update)
- **Depends on**: Metric Registry Service & API
- **Added**: 2026-06-08

---

## Layer 49: V2 Intelligence & Business Optimization

### Task: Proactive Context Surfacing with Predictive Agent Suggestions
- **Layer**: 49 — V2 Intelligence & Business Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement proactive context surfacing to push relevant business context to AI agents before they explicitly request it, improving context quality and reducing agent latency. Create packages/semantic-core/src/proactive-context-engine.ts with ProactiveContextEngine class: (1) analyzeAgentBehavior(workspaceId, agentId) tracking: frequently-accessed entity types, common query patterns (sales calls cluster around accounts/contacts, finance agents around transactions/metrics), (2) predictContext(currentContext, agentId, taskType) using behavioral history to pre-generate likely-needed context beyond the explicit query (e.g., when agent queries "account ABC", automatically surface top 5 deals, recent activity, key contacts), (3) deliverProactiveContext via MCP resource updates: define new MCP resource type "proactive_context" that clients can subscribe to, (4) measure effectiveness via engagement metrics (did agent use the suggestion, query latency reduction). Implement learning feedback loop: POST /api/v1/proactive/feedback endpoint to record agent interactions (suggested context accepted/ignored/modified), train a lightweight scoring model per agent/workspace. Create apps/api/migrations/069_add_proactive_context.sql with: agent_behavior_profiles table (workspace_id, agent_id, entity_types, query_patterns_json, learned_at), proactive_suggestions table (workspace_id, agent_id, suggestion_json, accepted: boolean, feedback_score). Expose: GET /api/v1/agents/:id/proactive-preview (show what would be suggested), POST /api/v1/agents/:id/proactive-settings (tune aggressiveness). Build dashboard component at apps/dashboard/components/agent-proactive-config.tsx showing: suggestion preview, acceptance rate, tuning controls. Add 14+ unit tests for suggestion logic, 8+ integration tests with synthetic agent logs. Reference code-style.md for async patterns and embedding-patterns.md for token budgeting (proactive context must be efficient).
- **Files**:
  - packages/semantic-core/src/proactive-context-engine.ts
  - packages/semantic-core/src/__tests__/proactive-context-engine.test.ts
  - packages/semantic-core/src/__tests__/proactive-context-engine.integration.test.ts
  - apps/api/migrations/069_add_proactive_context.sql
  - apps/api/src/routes/proactive-context.ts
  - apps/dashboard/components/agent-proactive-config.tsx
  - apps/api/src/__tests__/proactive-context.test.ts
- **Depends on**: Query Decomposition & Entity Type Detection, Cost-Per-Context Analytics & Optimization Recommendations
- **Added**: 2026-06-08

### Task: Cross-Company Benchmarking with Anonymized Insights & Analytics
- **Layer**: 49 — V2 Intelligence & Business Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an opt-in benchmarking system allowing customers to compare their Iris usage metrics and data patterns anonymously against industry peers, enabling data-driven optimization decisions. Create packages/semantic-core/src/benchmarking-service.ts with BenchmarkingService class: (1) collectMetrics(workspaceId) gathering anonymized stats: entity count by type, query patterns (top entity types queried), cache hit rates, token spend per entity type, connector diversity (how many connectors indexed), (2) hashWorkspaceId(workspaceId) to create permanent anonymous identifier (consistent across months), (3) uploadAnonMetrics(metrics, cohort) to central aggregation service (requires explicit opt-in), (4) retrieveBenchmarks(workspaceId, cohort) returning percentile rankings: "Your cache hit rate (45%) is at 60th percentile vs. similar-sized companies", "Entity count per connector: 10K (30th percentile)", "Token spend trending up 15% MoM (vs. peer 3% avg trend)". Create apps/api/migrations/069_add_benchmarking_data.sql with: workspace_benchmarks table (workspace_id, cohort, metric_type, value, submitted_at, percentile_rank, industry). Expose: GET /api/v1/benchmarks/opt-in (status), POST /api/v1/benchmarks/opt-in (join), GET /api/v1/benchmarks/peers (your rank vs. peers with insights). Build dashboard page at apps/dashboard/app/analytics/[workspaceId]/benchmarks/page.tsx with: peer comparison charts (histogram of entity counts, distribution of cache hit rates, cost per entity), personalized insights (areas to optimize based on peer patterns), monthly trends. Add regulatory UI: prominently show "You can opt out anytime" and describe data anonymization (workspace_id is hashed, only aggregated metrics shared). Add 12+ unit tests for metrics collection and anonymization logic, integration tests with synthetic multi-workspace data. Reference code-style.md for logging and api-conventions.md for endpoint patterns.
- **Files**:
  - packages/semantic-core/src/benchmarking-service.ts
  - packages/semantic-core/src/__tests__/benchmarking-service.test.ts
  - packages/semantic-core/src/__tests__/benchmarking-service.integration.test.ts
  - apps/api/migrations/069_add_benchmarking_data.sql
  - apps/api/src/routes/benchmarking.ts
  - apps/dashboard/app/analytics/[workspaceId]/benchmarks/page.tsx
  - apps/dashboard/components/peer-comparison-charts.tsx
  - apps/dashboard/components/benchmark-insights-panel.tsx
  - apps/api/src/__tests__/benchmarking.test.ts
- **Depends on**: Token Analytics Service & Dashboard, Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-08

### Task: Natural Language Index Configuration & Intent-Based Setup
- **Layer**: 49 — V2 Intelligence & Business Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable non-technical users to configure and optimize the semantic index using natural language commands and intent-based setup flows (e.g., "our fiscal year starts in February", "hide PII from sales team", "prioritize recent data"). Extend packages/semantic-core/src/nlp-config-parser.ts (if exists, else create packages/semantic-core/src/nlp-config-engine.ts): (1) parseConfigIntent(userInput, workspaceId) using gpt-4o-mini to detect intent categories: temporal ("fiscal year in Feb" → set fiscal_year_start: 2), retention ("archive data older than 6 months" → auto_archive_age_days: 180), access_control ("hide SSN from finance viewers" → PII masking rule), entity_merging ("contacts and people are the same" → dedup rule), (2) generateConfigDiff(intent) returning a diff of what would change with explanations, (3) applyConfigIntent(diff) persisting changes to index_configuration table. Integrate into a conversational UI: apps/dashboard/app/settings/[workspaceId]/nlp-config/page.tsx with: input chat box, intent confirmation ("I understood: archive entities older than 6 months. Is that right?"), preview of affected data (show 5 sample entities that would be archived), apply button. Create apps/api/migrations/070_add_nlp_config.sql with: nlp_intents table (workspace_id, intent, natural_text, interpreted_config_json, confirmed_by_user_id, applied_at). Implement safety: (1) all NLP-generated configs require user confirmation before application, (2) maintain rollback: track before/after snapshots, (3) limit scope: only allow intents for: temporal policies, retention rules, access control, and dedup rules (not destructive index operations). Add 16+ unit tests for intent parsing (temporal formats, retention ranges, access control semantics), 10+ integration tests with diverse user inputs. Reference code-style.md for error handling and api-conventions.md for config change patterns.
- **Files**:
  - packages/semantic-core/src/nlp-config-engine.ts
  - packages/semantic-core/src/__tests__/nlp-config-engine.test.ts
  - packages/semantic-core/src/__tests__/nlp-config-engine.integration.test.ts
  - apps/api/migrations/070_add_nlp_config.sql
  - apps/api/src/routes/nlp-config.ts
  - apps/dashboard/app/settings/[workspaceId]/nlp-config/page.tsx
  - apps/dashboard/components/nlp-config-chat.tsx
  - apps/dashboard/components/intent-confirmation-dialog.tsx
  - apps/api/src/__tests__/nlp-config.test.ts
- **Depends on**: Natural Language Index Configuration (if stub exists), Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-08

### Task: Agent Workflow Templates with Pre-Configured Iris Context
- **Layer**: 49 — V2 Intelligence & Business Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a library of pre-configured agent workflow templates tailored to common business functions, each with recommended Iris context settings and connector selections optimized for the workflow. Extend packages/semantic-core/src/workflow-templates.ts (if exists, else create packages/semantic-core/src/workflow-service.ts): (1) defineWorkflowTemplate(name, description, steps[], recommended_connectors[], context_hints) — e.g., "Sales Pipeline Review" template with steps [analyze_won_deals, forecast_next_quarter, identify_at_risk_accounts], connectors [HubSpot, Salesforce, Slack], context hints ["include recent deals, top accounts by ARR, key contacts"], (2) instantiateWorkflow(workspaceId, templateId) cloning template to user's workspace and auto-configuring recommended connectors if installed, (3) optimizeContextForWorkflow(workflowId) analyzing workflow step definitions to suggest MCP tool configurations (e.g., for "forecast_next_quarter", increase context budget and include metric definitions for ARR/pipeline). Create apps/api/migrations/070_add_workflow_templates.sql with: workflow_templates table (template_id, name, description, steps_json, recommended_connectors_json, context_config_json, created_at) and workflow_instances table (workspace_id, template_id, instance_id, customized_steps_json, enabled_connectors_json, context_config_json, created_at). Expose: GET /api/v1/workflows/templates (library), POST /api/v1/workflows/templates/:id/instantiate (create instance), GET /api/v1/workflows/:id/context-preview (show what context would be available). Build marketplace page at apps/dashboard/app/workflows/page.tsx: template gallery with categories (Sales, Finance, Ops, Engineering), install button, preview of steps and recommended connectors, user ratings. Include curated templates for: Sales Pipeline Review, Financial Forecast, Customer Health Analysis, Project Planning, Resource Allocation. Add 14+ unit tests for template instantiation and context optimization logic, 8+ integration tests with real connector configurations. Reference connector-patterns.md for connector semantics and api-conventions.md for REST patterns.
- **Files**:
  - packages/semantic-core/src/workflow-service.ts
  - packages/semantic-core/src/__tests__/workflow-service.test.ts
  - packages/semantic-core/src/__tests__/workflow-service.integration.test.ts
  - apps/api/migrations/070_add_workflow_templates.sql
  - apps/api/src/routes/workflow-templates.ts
  - apps/dashboard/app/workflows/page.tsx
  - apps/dashboard/app/workflows/[id]/preview/page.tsx
  - apps/dashboard/components/workflow-gallery.tsx
  - apps/dashboard/components/workflow-installer.tsx
  - apps/api/src/__tests__/workflow-templates.test.ts
- **Depends on**: Connector Template & Workflow Recipe System, Multi-Tenant Support & Workspace Isolation
- **Added**: 2026-06-08

---

## Layer 50: Advanced MCP Capabilities & Enterprise Features

### Task: MCP Resource Streaming with Progressive Context Expansion
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement MCP resource streaming to progressively expand context within a single MCP response, enabling AI agents to request minimal context first and expand incrementally. Create apps/mcp-server/src/resource-streaming.ts with ResourceStreamManager class: (1) define hierarchical resource types (context.summary → context.detailed → context.full-with-relationships), (2) support client-requested expansion depth and field selection, (3) stream results line-by-line where each line is a complete JSON result (no incomplete chunks mid-result), (4) respect context budget across streaming chunks (fail gracefully if exceeding budget), (5) add client cancellation support. Extend the query-context MCP tool to support optional fields: {query, expansionLevel: 'summary'|'detailed'|'full', maxTokens, fieldFilter: string[]}. Implement server-side caching of streaming sessions to avoid re-computing intermediate levels. Create apps/api/migrations/071_add_mcp_resource_sessions.sql with: mcp_resource_sessions table (session_id, workspace_id, client_id, query, expansion_level, cached_results_json, created_at, expires_at) for session-based caching. Add 14+ unit tests for streaming logic and budget enforcement, integration tests verifying multi-level expansion correctness, E2E test simulating agent interaction with progressive expansion. Reference api-conventions.md for MCP protocol patterns and embedding-patterns.md for token budgeting.
- **Files**:
  - apps/mcp-server/src/resource-streaming.ts
  - apps/mcp-server/src/__tests__/resource-streaming.test.ts
  - apps/mcp-server/src/__tests__/resource-streaming.integration.test.ts
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/api/migrations/071_add_mcp_resource_sessions.sql
  - apps/api/src/__tests__/resource-streaming.test.ts
- **Depends on**: Streaming Context Response API for Real-Time Agent Integration
- **Added**: 2026-06-08

### Task: Enterprise SSO Integration (SAML 2.0 & OpenID Connect)
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement SAML 2.0 and OpenID Connect (OIDC) authentication for enterprise customers requiring federated identity and SSO integration. Replace/extend Clerk with custom auth backend in apps/api/src/auth/enterprise-sso.ts supporting: (1) SAML 2.0 SP (service provider) implementation with signed assertion validation, attribute mapping (email, name, groups/roles), (2) OIDC provider configuration (Azure AD, Okta, Google Workspace, generic OIDC), (3) automatic user provisioning (JIT user creation on first login), (4) group/role synchronization from SAML attributes or OIDC claims into Iris role system, (5) session lifecycle management (single logout/SLO support). Create apps/api/migrations/072_add_enterprise_sso.sql with: sso_configurations table (workspace_id, provider: 'saml'|'oidc', provider_name, metadata_url, entity_id, acs_url, issuer, signing_cert, client_id, client_secret, attribute_mappings_json, enabled), sso_users table (user_id, workspace_id, external_id, external_email, sso_provider, synced_groups_json, last_sync_at). Build admin UI at apps/dashboard/app/admin/sso/page.tsx: (1) provider setup wizard (choose provider type, paste metadata XML or OIDC discovery URL), (2) attribute mapping editor (show expected SAML attributes/OIDC claims, allow user to map to Iris fields), (3) test login button, (4) sync logs showing successful/failed user provisions. Add 16+ unit tests for SAML assertion parsing and validation, OIDC token verification, user provisioning logic. Integration tests with mock SAML IdP and OIDC provider. Reference code-style.md for error handling and api-conventions.md for authentication patterns.
- **Files**:
  - apps/api/src/auth/enterprise-sso.ts
  - apps/api/src/auth/saml-handler.ts
  - apps/api/src/auth/oidc-handler.ts
  - apps/api/src/auth/__tests__/enterprise-sso.test.ts
  - apps/api/src/auth/__tests__/saml-handler.test.ts
  - apps/api/src/auth/__tests__/oidc-handler.test.ts
  - apps/api/migrations/072_add_enterprise_sso.sql
  - apps/api/src/routes/sso-config.ts
  - apps/dashboard/app/admin/sso/page.tsx
  - apps/dashboard/app/admin/sso/setup/page.tsx
  - apps/dashboard/components/sso-provider-selector.tsx
  - apps/dashboard/components/attribute-mapping-editor.tsx
  - apps/api/src/__tests__/sso-config.test.ts
- **Depends on**: MCP Server API Key Authentication & Workspace Isolation
- **Added**: 2026-06-08

### Task: Advanced Entity Enrichment Engine with External Data Integration
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an entity enrichment system that augments indexed entities with external data sources (company firmographics from Clearbit/Hunter, credit scores from Experian, social sentiment from Twitter/LinkedIn) to provide business context. Create packages/semantic-core/src/enrichment-engine.ts with EnrichmentEngine class: (1) define enrichment sources as plugins, each implementing: fetchEnrichmentData(entityId, entityAttributes), (2) rule-based enrichment triggers (auto-enrich contacts with firmographic data, auto-enrich companies with financial metrics), (3) async enrichment pipeline with rate limiting and failure handling (enrich in background, not on hot path), (4) versioning of enrichment data (track when data was added, refresh stale data). Create apps/api/migrations/073_add_entity_enrichment.sql with: entity_enrichments table (entity_id, enrichment_source, enrichment_data_json, confidence_score, added_at, expires_at, refresh_triggered_at), enrichment_sources table (source_id, name, api_endpoint, api_key_encrypted, enabled, rate_limit_rps). Implement built-in enrichers: (1) CompanyEnricher using a free API (e.g., company domain → company details via Crunchbase or similar), (2) PersonEnricher (email domain → company, LinkedIn profile URL if available), (3) SentimentEnricher (entity name → recent news/mentions via API). Expose: GET /api/v1/entities/:id/enrichments (view enrichment data), POST /api/v1/enrichments/configure/:source (setup new enrichment source), POST /api/v1/enrichments/refresh/:entityId (force refresh). Build admin panel at apps/dashboard/components/enrichment-sources-manager.tsx showing: enabled sources, rate limits, last refresh timestamp, enrichment coverage (% of entities enriched per source). Add 14+ unit tests for enrichment logic and rate limiting, integration tests with mock enrichment APIs. Reference embedding-patterns.md for data structuring.
- **Files**:
  - packages/semantic-core/src/enrichment-engine.ts
  - packages/semantic-core/src/__tests__/enrichment-engine.test.ts
  - packages/semantic-core/src/__tests__/enrichment-engine.integration.test.ts
  - packages/semantic-core/src/enrichers/company-enricher.ts
  - packages/semantic-core/src/enrichers/person-enricher.ts
  - packages/semantic-core/src/enrichers/sentiment-enricher.ts
  - apps/api/migrations/073_add_entity_enrichment.sql
  - apps/api/src/routes/enrichment-config.ts
  - apps/api/src/__tests__/enrichment-engine.test.ts
  - apps/dashboard/components/enrichment-sources-manager.tsx
  - apps/dashboard/app/admin/enrichment-setup/page.tsx
- **Depends on**: Entity Relationship Indexing, Knowledge Graph Service (Neo4j)
- **Added**: 2026-06-08

### Task: Schema Evolution & Backwards-Compatible Connector Updates
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement schema versioning and migration support to handle connector schema changes (new fields, renamed fields, deprecated entity types) without breaking existing indexes or client subscriptions. Create packages/semantic-core/src/schema-evolution.ts with SchemaEvolutionManager class: (1) track connector schema versions (version timestamp, fields, breaking vs non-breaking changes), (2) support field remapping (old_field_name → new_field_name with transformation function), (3) entity type versioning (mark entity type as deprecated, suggest replacement), (4) backward-compatible retrieval (clients requesting old schema get transformed results), (5) schema migration strategies (additive-only, with safe deprecation periods). Create apps/api/migrations/074_add_schema_versions.sql with: connector_schema_versions table (connector_id, version, schema_json, released_at, breaking_changes_json, migration_guide), schema_migrations table (workspace_id, source_schema_version, target_schema_version, migration_status: 'pending'|'in_progress'|'completed', started_at, completed_at, affected_entity_count). Implement automatic schema update checks: periodic GET to connector to detect schema changes, prompt admin with change summary and migration plan. Build admin UI at apps/dashboard/app/admin/schema-migrations/page.tsx showing: pending schema updates, migration impact (# entities affected, breaking changes), one-click apply migration. Add 16+ unit tests for schema transformation logic and backward compatibility, integration tests with real schema change scenarios. Reference connector-patterns.md for schema semantics.
- **Files**:
  - packages/semantic-core/src/schema-evolution.ts
  - packages/semantic-core/src/__tests__/schema-evolution.test.ts
  - packages/semantic-core/src/__tests__/schema-evolution.integration.test.ts
  - apps/api/migrations/074_add_schema_versions.sql
  - apps/api/src/routes/schema-migrations.ts
  - apps/api/src/__tests__/schema-evolution.test.ts
  - apps/dashboard/app/admin/schema-migrations/page.tsx
  - apps/dashboard/components/schema-migration-planner.tsx
- **Depends on**: Connector Instance Management API, Database Schema Migrations
- **Added**: 2026-06-08

### Task: Query Analytics & Intelligent Query Caching with Hit Prediction
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement advanced query analytics to track query patterns, predict cache hits, and learn user behavior for proactive cache warming. Create packages/semantic-core/src/query-analytics-engine.ts with QueryAnalyticsEngine class: (1) trackQuery(workspaceId, query, results, cacheHit, latencyMs, tokensSpent) recording all queries with metadata, (2) computeQuerySignatures(query) using query fingerprinting (normalize entity names, operators) to group semantically similar queries, (3) detectQueryPatterns(workspaceId) identifying: time-based patterns (queries spike at month-end), user-based patterns (user X always queries for Y entity type), (4) predictCacheHit(query, cacheState) using learned patterns to predict if a query will hit cache, (5) warmCache(workspaceId, predictions) proactively computing queries likely to be requested. Create apps/api/migrations/075_add_query_analytics.sql with: query_events table (query_id, workspace_id, user_id, query_text, query_signature, entity_types, cache_hit, latency_ms, tokens_spent, timestamp), query_patterns table (workspace_id, pattern_type: 'temporal'|'user'|'entity_type', pattern_definition_json, confidence_score, discovered_at), cache_warming_jobs table (workspace_id, warming_job_id, triggered_query_signatures, executed_at, cache_hit_improvement_rate). Expose: GET /api/v1/analytics/queries (query history with patterns), POST /api/v1/analytics/cache-warming/trigger (manual warm), GET /api/v1/analytics/query-patterns (show discovered patterns). Build dashboard page at apps/dashboard/app/analytics/[workspaceId]/queries/page.tsx with: query heatmap (time × query type showing frequency), cache performance (hit rate, latency improvement from caching), pattern visualization (top patterns, predicted hot queries). Add 16+ unit tests for fingerprinting, pattern detection, and hit prediction, integration tests with real query logs. Reference embedding-patterns.md for caching patterns.
- **Files**:
  - packages/semantic-core/src/query-analytics-engine.ts
  - packages/semantic-core/src/__tests__/query-analytics-engine.test.ts
  - packages/semantic-core/src/__tests__/query-analytics-engine.integration.test.ts
  - apps/api/migrations/075_add_query_analytics.sql
  - apps/api/src/routes/query-analytics.ts
  - apps/api/src/__tests__/query-analytics.test.ts
  - apps/dashboard/app/analytics/[workspaceId]/queries/page.tsx
  - apps/dashboard/components/query-heatmap-chart.tsx
  - apps/dashboard/components/cache-performance-dashboard.tsx
  - apps/dashboard/components/query-pattern-explorer.tsx
- **Depends on**: Semantic Cache, Semantic Response Cache
- **Added**: 2026-06-08

### Task: ProactiveContextEngine Integration Tests & Full Implementation
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete the integration test suite for ProactiveContextEngine and ensure full end-to-end behavioral profiling. The unit tests exist but integration tests are stubbed at packages/semantic-core/src/__tests__/proactive-context-engine.integration.test.ts. Implement: (1) recordQueryEvent(workspaceId, userId, query, entityTypes, tokensSpent, latencyMs) — store query patterns in Postgres (requires migration 076_add_proactive_integration_tables.sql with query_event_log, behavioral_profiles, suggestion_cache tables), (2) buildBehavioralProfile(workspaceId) — aggregate query history to compute: entity_type_affinity (which entity types does this user query most?), temporal_patterns (hourly/daily spikes), context_expansion_habits (does user expand context? how often?), (3) generateSuggestions(workspaceId, userId, currentQuery) — use learned profiles to suggest related entities/queries before user asks, (4) recordFeedbackLoop(suggestionId, accepted: boolean) — track suggestion quality. Add 14 comprehensive integration tests: query recording with concurrent events, behavioral profile computation accuracy, suggestion ranking by confidence score, feedback loop impact on future suggestions, edge cases (new users with no history, single anomalous query), TTL cleanup of stale suggestion cache. Use docker-compose Postgres instance. Reference proactive-context-engine.ts for internal signatures but expand with full DB integration.
- **Files**:
  - packages/semantic-core/src/proactive-context-engine.ts (update: add integration methods)
  - packages/semantic-core/src/__tests__/proactive-context-engine.integration.test.ts (replace stub)
  - apps/api/migrations/076_add_proactive_integration_tables.sql
  - apps/api/src/routes/proactive-context.ts (update with recording endpoints)
- **Depends on**: Proactive Context Surfacing (completed)
- **Added**: 2026-06-08

### Task: DataLineageService Integration Tests & Lifecycle Management
- **Layer**: 50 — Advanced MCP Capabilities & Enterprise Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Complete integration tests and lifecycle management for DataLineageService. The unit tests exist but integration tests are stubbed at packages/semantic-core/src/__tests__/data-lineage.integration.test.ts. Implement: (1) recordOrigin(workspaceId, entityId, sourceConnectorId, extractedAt, metadata) — create/update data_lineage records with full Postgres integration, (2) getLineage(workspaceId, entityId) — retrieve complete ancestry chain (includes all upstream transformations), (3) trackDataTransformation(workspaceId, sourceEntityIds: string[], targetEntityId, transformationType: 'dedup'|'enrichment'|'aggregation', transformationDetails) — record how entities are derived from others, (4) getImpactedDownstream(workspaceId, entityId) — find all entities derived from a given entity (useful for deletion cascade analysis), (5) computeDataFreshness(workspaceId, entityId) — calculate time since data last changed in source, (6) archiveObsoleteLineage(workspaceId, beforeDate) — cleanup old lineage records with configurable retention. Add 12 integration tests: recording origin with metadata, multi-hop lineage retrieval, transformation chain tracking, impact analysis for deletion safety, bulk batch origin recording (1000+ entities), concurrent lineage updates without race conditions. Use postgres docker-compose. Test with real SemanticEntity transformations from connector flow.
- **Files**:
  - packages/semantic-core/src/data-lineage.ts (update: add missing integration methods)
  - packages/semantic-core/src/__tests__/data-lineage.integration.test.ts (replace stub)
  - apps/api/migrations/077_enhance_data_lineage_schema.sql (add transformation_tracking table, impact_analysis view)
  - apps/api/src/routes/data-lineage.ts (update with new endpoints: GET /api/v1/lineage/:entityId, POST /api/v1/lineage/transformations, GET /api/v1/lineage/:entityId/downstream)
- **Depends on**: Entity Relationship Indexing (completed)
- **Added**: 2026-06-08

### Task: Multi-Tenant Workspace Isolation & Cost Attribution
- **Layer**: 51 — Post-MVP Hardening & Scale
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive multi-tenant support with workspace isolation guarantees and per-workspace cost attribution. Create packages/semantic-core/src/multi-tenant-manager.ts with: (1) enforceWorkspaceIsolation() middleware for all API/MCP routes — verify JWT workspace claim against resource workspace_id before any query (prevents data leakage), (2) validateWorkspaceBoundaries(workspaceId, entityId) — ensure entities returned to a query belong to the requested workspace, (3) computeWorkspaceCosts(workspaceId, periodStart, periodEnd) — aggregate: embeddings_cost (# embeddings × $0.02/1M tokens), cache_hits_saved (# hits × baseline_tokens), compression_savings, mcp_query_cost (# queries × per-query cost). Create apps/api/migrations/078_multi_tenant_cost_tracking.sql with: workspace_cost_attribution table (workspace_id, date, cost_category: 'embeddings'|'queries'|'storage'|'cache_miss', amount_cents, metadata_json), workspace_query_counts table (workspace_id, date, query_type: 'vector_search'|'graph_expansion'|'compression', count, avg_latency_ms). Build REST routes: GET /api/v1/workspaces/:id/costs (period-aware, currency conversion), GET /api/v1/workspaces/:id/cost-breakdown (pie chart data: % by category), POST /api/v1/admin/cost-audit (export all costs for a workspace). Build dashboard page at apps/dashboard/app/workspaces/[id]/costs/page.tsx showing: daily cost trend (line chart), cost breakdown by category (pie), top-10 most expensive queries, cost per entity type. Add 13 unit tests: workspace isolation enforcement, cost calculation accuracy (with known sample data), currency conversions, edge cases (empty period, single-entity cost). Integration tests: multi-workspace queries with isolation verification, cost aggregation over 30 days, cost rollup across connector types.
- **Files**:
  - packages/semantic-core/src/multi-tenant-manager.ts
  - packages/semantic-core/src/__tests__/multi-tenant-manager.test.ts
  - apps/api/migrations/078_multi_tenant_cost_tracking.sql
  - apps/api/src/routes/workspace-costs.ts
  - apps/api/src/routes/admin-cost-audit.ts
  - apps/api/src/__tests__/multi-tenant.test.ts
  - apps/api/src/__tests__/workspace-costs.test.ts
  - apps/dashboard/app/workspaces/[id]/costs/page.tsx
  - apps/dashboard/components/cost-breakdown-charts.tsx
- **Depends on**: Role-Based Context Segmentation (completed)
- **Added**: 2026-06-08

### Task: Connector Performance Optimization & Batching Improvements
- **Layer**: 51 — Post-MVP Hardening & Scale
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Optimize connector sync performance for large-scale data sources through advanced batching, pagination tuning, and concurrency control. Create packages/connector-sdk/src/performance-optimizer.ts with: (1) adaptiveBatchSize(connectorType, recordsProcessedSoFar, avgRecordSize, maxMemory=512MB) — auto-tune batch size based on actual record size and available memory (start at 100, scale to 500 if records < 1KB), (2) identifyPaginationPattern(previousRequests) — detect if API uses offset/cursor/keyset pagination and recommend most efficient (cursor > keyset > offset), (3) computeOptimalConcurrency(connectorType, rateLimit, avgLatency, errorRate) — auto-scale parallel request concurrency (start at 3, scale to 10 if error_rate < 1%), (4) estimateSyncDuration(connectorId, totalRecords, currentThroughput) — predict when sync will complete and alert if > configured max_duration. Create apps/api/migrations/079_connector_performance_metrics.sql with: connector_sync_metrics table (connector_id, sync_run_id, metric_name: 'batch_size'|'concurrency'|'pagination_type'|'total_records'|'duration_ms'|'throughput_records_per_sec', value, recorded_at). Expose REST: GET /api/v1/connectors/:id/performance-stats (show trends in batch size, concurrency, throughput over last 30 syncs), POST /api/v1/connectors/:id/optimize (trigger analysis and recommend config changes). Build admin dashboard page at apps/dashboard/app/admin/connector-optimization/page.tsx with: performance leaderboard (fastest/slowest connectors by throughput), performance metrics over time (batch size evolution, concurrency ramp), optimization recommendations. Add 11 unit tests: batch size adaptation with varying record sizes, pagination pattern detection (offset vs cursor APIs), concurrency scaling logic, sync duration estimation accuracy. Integration tests: full sync with adaptive batching on HubSpot connector, concurrent sync of 3 connectors without resource contention.
- **Files**:
  - packages/connector-sdk/src/performance-optimizer.ts
  - packages/connector-sdk/src/__tests__/performance-optimizer.test.ts
  - apps/api/migrations/079_connector_performance_metrics.sql
  - apps/api/src/routes/connector-performance.ts
  - apps/api/src/__tests__/connector-performance.test.ts
  - apps/dashboard/app/admin/connector-optimization/page.tsx
  - apps/dashboard/components/connector-performance-leaderboard.tsx
- **Depends on**: Connector Framework (completed), Sync Scheduling (completed)
- **Added**: 2026-06-08

---

## Layer 52: MCP Tool Enhancements & Streaming

### Task: MCP Streaming Context Tool & Progressive Expansion
- **Layer**: 52 — MCP Tool Enhancements & Streaming
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a streaming MCP tool that progressively expands context as needed, reducing initial response token cost while allowing the client to request deeper context. Create apps/mcp-server/src/tools/streaming-context.ts with: (1) streamingQueryContext(query, initialBudget=500, maxBudget=2000, expansionLevels=['summary', 'detailed', 'full']) — returns initial compressed context, emits additional chunks on client request, (2) contextExpansionHeuristics that predict which expansion layer the client will request based on entity type and query complexity, (3) partial response tracking (partial: true, expansionKey) so client can later call getContextExpansion(expansionKey) to fill in skipped layers. Update apps/mcp-server/src/server.ts to register the new tool. Create comprehensive test suite (15+ tests) covering: initial budget enforcement, progressive expansion chunks, client-side state management, timeout handling if expansion not consumed. Integration tests: real query with multi-level expansion, verify total token cost < full context approach by 40%.
- **Files**:
  - apps/mcp-server/src/tools/streaming-context.ts
  - apps/mcp-server/src/__tests__/streaming-context.test.ts
  - apps/mcp-server/src/__tests__/streaming-context.integration.test.ts
- **Depends on**: MCP Server Bootstrap (completed), Query Context Tool (completed)
- **Added**: 2026-06-08

### Task: Query Anomaly Detection & Metrics Forecasting Engine
- **Layer**: 52 — MCP Tool Enhancements & Streaming
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an anomaly detection and forecasting service for metrics to help teams surface unexpected business changes. Create packages/semantic-core/src/metrics-anomaly-detector.ts with: (1) detectAnomalies(metricId, lookbackDays=30, sensitivityLevel='medium') using Z-score (|value - mean| > sensitivityLevel * stdDev) on historical metric values, (2) forecastMetricValue(metricId, daysAhead=7) using exponential smoothing (alpha=0.3) to predict future values, (3) anomalyContext(metricId, timestamp) to retrieve contextual entities that changed around the anomaly time (from lineage_events). Persist anomalies to new migration 080_metric_anomalies.sql table (metric_id, anomaly_date, severity: 'low'|'medium'|'high', detected_at, acknowledged_at, notes). Expose REST GET /api/v1/metrics/:id/anomalies and POST /api/v1/metrics/:id/anomalies/:anomalyId/acknowledge. Add MCP tool detect-anomalies for query-time context enrichment ("metric X had an anomaly 2 days ago"). Create 18 unit tests for Z-score calculation, exponential smoothing, edge cases (zero variance, single data point). Integration tests: historical anomaly detection against real database, forecast accuracy on 30-day dataset.
- **Files**:
  - packages/semantic-core/src/metrics-anomaly-detector.ts
  - packages/semantic-core/src/__tests__/metrics-anomaly-detector.test.ts
  - packages/semantic-core/src/__tests__/metrics-anomaly-detector.integration.test.ts
  - apps/api/migrations/080_metric_anomalies.sql
  - apps/api/src/routes/metrics-anomalies.ts
  - apps/api/src/__tests__/metrics-anomalies.test.ts
  - apps/mcp-server/src/tools/detect-anomalies.ts
  - apps/dashboard/components/anomaly-timeline.tsx
- **Depends on**: Metric Registry (completed), Data Lineage (completed)
- **Added**: 2026-06-08

### Task: Advanced MCP Aggregation & Comparison Tools
- **Layer**: 52 — MCP Tool Enhancements & Streaming
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement aggregation and entity comparison MCP tools to enable complex business questions ("compare top 5 customers by ARR and show their churn risk"). Create apps/mcp-server/src/tools/aggregate-entities.ts with: (1) aggregateEntities(entityType, groupByAttribute, aggregations=['count', 'sum', 'avg', 'max', 'min'], filters, topK=10) returning grouped results with token budget enforcement, (2) compareEntities(entityIds=[], attributes=['all'|specific list], diffHighlight=true) showing side-by-side attributes with changes highlighted. Implement token-efficient comparison by: only including differing attributes if diffHighlight=true, using abbreviated labels, respecting context budget. Register both tools in server.ts. Create 16 unit tests covering: aggregation correctness, budget enforcement on large result sets, attribute filtering, edge cases (no results, single entity). Integration tests: compare 3 HubSpot contacts across 8 attributes within 300-token budget.
- **Files**:
  - apps/mcp-server/src/tools/aggregate-entities.ts
  - apps/mcp-server/src/tools/compare-entities.ts
  - apps/mcp-server/src/__tests__/aggregate-entities.test.ts
  - apps/mcp-server/src/__tests__/compare-entities.test.ts
  - apps/mcp-server/src/__tests__/mcp-aggregation.integration.test.ts
- **Depends on**: Query Context Tool (completed), Advanced Query Context (completed)
- **Added**: 2026-06-08

### Task: CLI Tooling & Developer Experience Enhancements
- **Layer**: 52 — MCP Tool Enhancements & Streaming
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance the CLI tool (scripts/iris) with developer-friendly commands for local testing and debugging. Extend scripts/iris to support: (1) iris connector:test <name> [--watch] — run connector tests with live reload, (2) iris mcp:debug — start MCP server in debug mode with verbose logging to stdout, (3) iris index:inspect — interactive CLI to query the local vector index (search by text, see similarity scores, view entity embeddings), (4) iris sync:simulate <connectorId> — dry-run a sync without persisting to DB, validate schema mapping, show token estimates. Build these as TypeScript CLI utilities in scripts/cli/, use commander.js for argument parsing, ensure all commands have --help and examples. Create comprehensive CLI tests (8+) covering: argument parsing, error handling, command execution validation. Document all commands in a new CLI_GUIDE.md.
- **Files**:
  - scripts/cli/test-connector.ts
  - scripts/cli/debug-mcp.ts
  - scripts/cli/inspect-index.ts
  - scripts/cli/simulate-sync.ts
  - scripts/cli/index.ts
  - scripts/cli/__tests__/cli.test.ts
  - docs/CLI_GUIDE.md
- **Depends on**: Local Infrastructure (completed), MCP Server Bootstrap (completed)
- **Added**: 2026-06-08

---

## Layer 53: Data Quality & Resilience

### Task: Entity Validation Engine with Data Quality Rules
- **Layer**: 53 — Data Quality & Resilience
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a comprehensive entity validation system that enforces data quality rules defined by users, catching malformed or incomplete data before indexing. Create packages/semantic-core/src/entity-validator.ts with EntityValidationEngine class: (1) define validation rules (required fields, field type constraints, regex patterns, cross-field dependencies e.g., "if status=closed, closedAt must be set"), (2) support both built-in rules (non-null, email format, phone format) and user-custom rules, (3) validate entities at sync time (reject/quarantine invalid records), (4) bulk re-validate indexed entities on-demand, (5) generate validation reports (# valid, # invalid, # warnings per entity type). Create apps/api/migrations/081_add_entity_validation_rules.sql with: validation_rules table (workspace_id, rule_id, entity_type, rule_name, rule_definition_json, is_blocking: boolean, created_by_user_id), validation_failures table (workspace_id, entity_id, rule_id, failure_reason, occurred_at, acknowledged: boolean). Expose REST: POST /api/v1/validation/rules (create rule), GET /api/v1/validation/rules (list rules), POST /api/v1/validation/validate-entity (test rule on sample entity), GET /api/v1/validation/failures (paginated list). Build dashboard page at apps/dashboard/app/admin/data-quality/rules/page.tsx with: rule builder UI, test panel, failure explorer. Add 18+ unit tests for rule evaluation, edge cases, cross-field dependencies. Integration tests with real entities from multiple connectors. Reference code-style.md for validation patterns.
- **Files**:
  - packages/semantic-core/src/entity-validator.ts
  - packages/semantic-core/src/__tests__/entity-validator.test.ts
  - packages/semantic-core/src/__tests__/entity-validator.integration.test.ts
  - apps/api/migrations/081_add_entity_validation_rules.sql
  - apps/api/src/routes/entity-validation.ts
  - apps/api/src/__tests__/entity-validation.test.ts
  - apps/dashboard/app/admin/data-quality/rules/page.tsx
  - apps/dashboard/components/validation-rule-builder.tsx
  - apps/dashboard/components/validation-failure-explorer.tsx
- **Depends on**: Indexer Implementation (completed), Entity Schema & Transformation (completed)
- **Added**: 2026-06-08

### Task: Index Rebuild & Corruption Recovery Tools
- **Layer**: 53 — Data Quality & Resilience
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build tools for detecting and repairing index corruption, handling edge cases like orphaned vectors, missing relationships, and stale cache entries. Create packages/semantic-core/src/index-repair-service.ts with IndexRepairService class: (1) scanIndexIntegrity(workspaceId, progressCallback) scanning for inconsistencies: orphaned vectors, missing vectors, broken relationships, (2) reportCorruption(workspaceId) generating detailed report, (3) rebuildIndex(workspaceId, entityTypeFilter) re-extracting vectors and recomputing relationships, (4) rollbackIndexSnapshot(workspaceId, snapshotId) restoring from backup. Create apps/api/migrations/082_add_index_repair_logs.sql with integrity_scans and rebuild_jobs tables. Expose REST for integrity check, rebuild trigger, snapshot rollback. Build admin page at apps/dashboard/app/admin/index-health/page.tsx with corruption detection status, rebuild trigger with dry-run mode, progress bar. Add 14+ unit tests for corruption detection, rebuild correctness, integrity verification. Integration tests: introduce corruption, detect/repair, verify consistency. Reference code-style.md for logging.
- **Files**:
  - packages/semantic-core/src/index-repair-service.ts
  - packages/semantic-core/src/__tests__/index-repair-service.test.ts
  - packages/semantic-core/src/__tests__/index-repair-service.integration.test.ts
  - apps/api/migrations/082_add_index_repair_logs.sql
  - apps/api/src/routes/index-repair.ts
  - apps/api/src/__tests__/index-repair.test.ts
  - apps/dashboard/app/admin/index-health/page.tsx
  - apps/dashboard/components/index-corruption-detector.tsx
  - apps/dashboard/components/rebuild-progress-panel.tsx
- **Depends on**: Semantic Index (completed), Index Snapshot Export & Disaster Recovery
- **Added**: 2026-06-08

### Task: Custom Transformation Pipeline & Entity Mapping Language
- **Layer**: 53 — Data Quality & Resilience
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable users to define custom transformation pipelines for entity mapping and field normalization without writing code. Create packages/semantic-core/src/transformation-dsl.ts with a DSL engine for chainable transformations: (1) mapping (rename fields), filtering (remove/include-only fields), normalization (case, trim, regex replace), computed fields (concatenate, extract substrings), date formatting, (2) build rule chains executing in sequence on ingested entities, (3) apply transformations at sync time before indexing, (4) test transformations on sample data before activation. Create apps/api/migrations/083_add_custom_transformations.sql with transformation_rules table. Expose REST for testing rules and activating rules. Build transformation builder UI at apps/dashboard/app/admin/transformations/page.tsx with rule chain editor, live preview, connector selector. Add 16+ unit tests for each transformation type, rule chaining, edge cases. Integration tests applying chains to real connector data. Reference code-style.md for validation.
- **Files**:
  - packages/semantic-core/src/transformation-dsl.ts
  - packages/semantic-core/src/__tests__/transformation-dsl.test.ts
  - apps/api/migrations/083_add_custom_transformations.sql
  - apps/api/src/routes/transformations.ts
  - apps/api/src/__tests__/transformations.test.ts
  - apps/dashboard/app/admin/transformations/page.tsx
  - apps/dashboard/components/transformation-rule-editor.tsx
  - apps/dashboard/components/transformation-test-panel.tsx
- **Depends on**: Entity Schema & Transformation (completed)
- **Added**: 2026-06-08

---

## Layer 54: Connector Expansion & V1 Features

### Task: Google Drive Connector Implementation
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a Google Drive connector in packages/connectors/google-drive/ for syncing files, folders, and shared drives as queryable entities. Implement connect() with OAuth2 (scopes: 'drive.readonly', 'drive.metadata.readonly'), sync() as AsyncGenerator yielding File and Folder entities, getSchema() exposing file metadata (name, mimeType, owner, sharedWith, createdTime, modifiedTime, webViewLink), healthCheck(). Use cursor-based pagination via pageToken for incremental sync. Transform raw Google Drive API responses into SemanticEntity format with relationships (file_in_folder, shared_with). Create apps/connectors/google-drive/ with connector.ts, manifest.ts, transformers.ts. Include ConnectorManifest with OAuth config. Add 16+ tests using MSW to mock Google Drive API (list files, folder traversal, shared drives). Integration test: sync a folder tree with 50+ files, verify relationship edges and workspace isolation. Reference connector-patterns.md for transform patterns and code-style.md for error handling.
- **Files**:
  - packages/connectors/google-drive/src/google-drive-connector.ts
  - packages/connectors/google-drive/src/manifest.ts
  - packages/connectors/google-drive/src/transformers.ts
  - packages/connectors/google-drive/src/__tests__/google-drive-connector.test.ts
  - packages/connectors/google-drive/tests/fixtures/files.json
  - packages/connectors/google-drive/tests/fixtures/folders.json
  - packages/connectors/google-drive/package.json
- **Depends on**: Connector Registry (completed)
- **Added**: 2026-06-08

### Task: PostgreSQL Direct Connector Implementation
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a PostgreSQL direct database connector in packages/connectors/postgres/ for syncing tables and views as entity types. Implement connect() with SSL/TLS support, sync() as AsyncGenerator discovering tables via information_schema and yielding rows as SemanticEntity objects, getSchema() returning table definitions (columns, types, pk, fk), healthCheck(). Support incremental sync via timestamp/sequence columns (auto-detection). Transform each table row into a SemanticEntity with attributes mapped from columns; create relationships for foreign keys. Handle type coercion (SQL types → JSON/attribute types). Create packages/connectors/postgres/ with connector.ts, manifest.ts, sql-query-builder.ts, transformers.ts. Include ConnectorManifest with configSchema (host, port, database, username, password, sslMode). Add 18+ unit tests with containerized postgres (docker) for real SQL tests. Integration test: sync a 3-table schema with FK relationships, verify edge creation and query-time graph expansion. Reference connector-patterns.md for pagination patterns.
- **Files**:
  - packages/connectors/postgres/src/postgres-connector.ts
  - packages/connectors/postgres/src/manifest.ts
  - packages/connectors/postgres/src/sql-query-builder.ts
  - packages/connectors/postgres/src/transformers.ts
  - packages/connectors/postgres/src/__tests__/postgres-connector.test.ts
  - packages/connectors/postgres/src/__tests__/postgres-connector.integration.test.ts
  - packages/connectors/postgres/package.json
- **Depends on**: Connector Registry (completed), Sync Scheduling & Frequency Configuration (completed)
- **Added**: 2026-06-08

### Task: Schema Auto-Discovery & Human-in-the-Loop Confirmation
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a schema discovery and user confirmation workflow for automating entity type and relationship detection. Create packages/semantic-core/src/schema-discovery.ts with SchemaDiscoveryEngine: (1) detectEntityTypes(connectorId) automatically discovering entity types from sync metadata, (2) suggestRelationships(entityType1, entityType2) using heuristics (FK patterns, id suffix matches, name similarity), (3) generateMappingReport() showing discovered types, fields, confidence scores. Create apps/api/migrations/084_add_schema_discovery.sql with entity_type_suggestions and relationship_suggestions tables. Expose REST: POST /api/v1/connectors/:id/discover-schema (triggers discovery + stores suggestions), GET /api/v1/connectors/:id/schema-suggestions (lists all suggestions with confidence), POST /api/v1/schema-suggestions/:id/confirm (user confirms suggestion, applies to workspace). Build dashboard page at apps/dashboard/app/admin/schema-discovery/page.tsx with discovery wizard: (1) trigger discovery button, (2) interactive suggestions table (entity types + fields), (3) confirmation checkboxes, (4) relationship mapping preview with visual graph. Add 16+ unit tests for discovery heuristics, confidence scoring, conflict resolution. Integration test: run discovery on HubSpot connector, verify detected entity types, confirm suggestions, verify in retrieval. Reference embedding-patterns.md for semantic similarity checks in relationship detection.
- **Files**:
  - packages/semantic-core/src/schema-discovery.ts
  - packages/semantic-core/src/__tests__/schema-discovery.test.ts
  - packages/semantic-core/src/__tests__/schema-discovery.integration.test.ts
  - apps/api/migrations/084_add_schema_discovery.sql
  - apps/api/src/routes/schema-discovery.ts
  - apps/api/src/__tests__/schema-discovery.test.ts
  - apps/dashboard/app/admin/schema-discovery/page.tsx
  - apps/dashboard/components/schema-discovery-wizard.tsx
  - apps/dashboard/components/entity-type-suggester.tsx
  - apps/dashboard/components/relationship-mapper.tsx
- **Depends on**: Connector Registry (completed), Entity Schema & Transformation (completed)
- **Added**: 2026-06-08

### Task: Batch Sync Optimization & Performance Tuning
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a performance optimization suite for connector syncs, reducing latency and token costs for large-scale ingestion. Create packages/semantic-core/src/sync-optimizer.ts with SyncOptimizer class: (1) analyzeHistoricalSyncMetrics(connectorId, days=30) calculating P50/P95/P99 latencies, entity/token throughput, failure rates, (2) recommendOptimalBatchSize(connectorId, targetDurationMs=300_000) using linear regression to predict optimal batch size (default 100), (3) recommendParallelism(connectorId, cpuCount) computing safe concurrency given connector rate limits, (4) getOptimizationReport(connectorId) showing bottlenecks (API rate limit vs. processing time). Create apps/api/migrations/085_add_sync_metrics.sql with sync_metrics table (connector_id, sync_id, batch_size, entity_count, token_count, durationMs, entity_throughput). Expose REST: GET /api/v1/connectors/:id/sync-metrics, POST /api/v1/connectors/:id/optimize (triggers analyzer). Build dashboard panel at apps/dashboard/components/sync-optimization-panel.tsx with metric charts (throughput over time), optimization recommendations. Update SyncWorker to log metrics to new table. Add 14+ unit tests for regression analysis, batch size tuning, parallelism calculation. Integration test: simulate 1000+ entity sync, verify metrics logged, run optimizer, confirm recommendation improves throughput by ≥10%. Reference code-style.md for structured logging.
- **Files**:
  - packages/semantic-core/src/sync-optimizer.ts
  - packages/semantic-core/src/__tests__/sync-optimizer.test.ts
  - packages/semantic-core/src/__tests__/sync-optimizer.integration.test.ts
  - apps/api/migrations/085_add_sync_metrics.sql
  - apps/api/src/routes/sync-metrics.ts
  - apps/api/src/__tests__/sync-metrics.test.ts
  - apps/api/src/workers/sync-worker.ts (update to log metrics)
  - apps/dashboard/components/sync-optimization-panel.tsx
- **Depends on**: Sync Scheduling & Frequency Configuration (completed), Indexer Implementation (completed)
- **Added**: 2026-06-08

### Task: Multi-LLM Router & Provider Abstraction Layer
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build an extensible LLM provider abstraction layer to support Claude, GPT-4, Gemini, and local models (via Ollama) with unified token counting and cost tracking. Create packages/semantic-core/src/llm-router.ts with LlmProvider interface (embed, complete, countTokens), concrete implementations for OpenAI, Anthropic, Google, and Ollama. Add provider-specific prompt optimization (e.g., Claude system prompts vs. OpenAI instructions). Create apps/api/migrations/086_add_llm_provider_config.sql with llm_providers table (workspace_id, provider_name, model_id, api_key_encrypted, cost_per_1m_tokens, default_for_use_case). Expose REST: GET /api/v1/llm-providers (list configured), POST /api/v1/llm-providers (register), DELETE /api/v1/llm-providers/:id (deregister), POST /api/v1/llm-providers/:id/test (verify connection). Update MCP server's embedding and completion calls to route through the new abstraction. Build dashboard page at apps/dashboard/app/admin/llm-configuration/page.tsx with provider selector, cost projections, auto-routing rules. Add 20+ unit tests for each provider implementation, token counting accuracy, cost calculation. Integration test: embed same input via three providers, verify consistent rankings. Reference code-style.md for error handling and logging.
- **Files**:
  - packages/semantic-core/src/llm-router.ts
  - packages/semantic-core/src/llm-providers/openai-provider.ts
  - packages/semantic-core/src/llm-providers/anthropic-provider.ts
  - packages/semantic-core/src/llm-providers/google-provider.ts
  - packages/semantic-core/src/llm-providers/ollama-provider.ts
  - packages/semantic-core/src/__tests__/llm-router.test.ts
  - packages/semantic-core/src/llm-providers/__tests__/openai-provider.test.ts
  - packages/semantic-core/src/llm-providers/__tests__/anthropic-provider.test.ts
  - apps/api/migrations/086_add_llm_provider_config.sql
  - apps/api/src/routes/llm-providers.ts
  - apps/api/src/__tests__/llm-providers.test.ts
  - apps/dashboard/app/admin/llm-configuration/page.tsx
  - apps/dashboard/components/llm-provider-selector.tsx
  - apps/dashboard/components/cost-projection-calculator.tsx
- **Depends on**: Multi-LLM Provider Support (completed)
- **Added**: 2026-06-08

### Task: Advanced Entity Linking & Normalization Engine
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build intelligent cross-connector entity linking to merge duplicate entities across different data sources (e.g., same customer in HubSpot and Salesforce). Create packages/semantic-core/src/entity-linker.ts with EntityLinker class: (1) detectPotentialMatches(entityId) using fuzzy name matching (Levenshtein), domain-based email matching, semantic similarity > 0.92 on embeddings, (2) scoreMatch(entityA, entityB) combining multiple signals (name similarity, attribute overlap, relationship graph distance), (3) suggestMerges(workspaceId) batching all potential cross-connector matches with confidence scores, (4) confirmMerge(sourceId, targetId) merging entities, updating relationships, logging merge history. Create apps/api/migrations/087_add_entity_linking.sql with entity_link_suggestions, entity_merges, merge_history tables. Expose REST: GET /api/v1/entity-linking/suggestions (paginated suggestions with scores), POST /api/v1/entity-linking/merge/:id (confirm and execute merge), GET /api/v1/entity-linking/history (audit trail). Build dashboard page at apps/dashboard/app/admin/entity-linking/page.tsx with merge preview (side-by-side entity comparison), confidence scores, relationship impact visualization, undo capability. Add 18+ unit tests for matching algorithms, score combination, edge cases (null attributes, timezone-aware dates). Integration test: index 100 contacts across 3 sources with intentional duplicates, verify detection rate ≥95%, confirm merge correctness. Reference embedding-patterns.md for semantic similarity thresholds.
- **Files**:
  - packages/semantic-core/src/entity-linker.ts
  - packages/semantic-core/src/__tests__/entity-linker.test.ts
  - packages/semantic-core/src/__tests__/entity-linker.integration.test.ts
  - apps/api/migrations/087_add_entity_linking.sql
  - apps/api/src/routes/entity-linking.ts
  - apps/api/src/__tests__/entity-linking.test.ts
  - apps/dashboard/app/admin/entity-linking/page.tsx
  - apps/dashboard/components/entity-merge-preview.tsx
  - apps/dashboard/components/entity-linking-suggestions-table.tsx
  - apps/dashboard/components/merge-impact-visualizer.tsx
- **Depends on**: Entity Schema & Transformation (completed), Semantic Index (completed)
- **Added**: 2026-06-08

### Task: MCP Tool Versioning & Backwards Compatibility Manager
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement version management for MCP tools to enable non-breaking feature additions and schema evolution. Create packages/semantic-core/src/mcp-tool-versioning.ts with ToolVersionManager: (1) registerToolVersion(toolName, version, schema, handler) allowing multiple handlers per tool, (2) resolveHandler(toolName, clientVersion) selecting appropriate handler based on client compatibility, (3) generateClientSdkStub(toolName, language) generating TypeScript/Python stub with type defs for each version, (4) deprecateVersion(toolName, version, sunsetDate) marking versions for removal with grace period. Create apps/api/migrations/088_add_mcp_tool_versions.sql with mcp_tool_versions, mcp_tool_deprecations tables. Update MCP server to negotiate versions in capabilities handshake. Add version headers to all MCP responses. Build admin dashboard page at apps/dashboard/app/admin/mcp-tools/page.tsx with tool browser: search, version selector, schema viewer, handler test console, usage metrics per version. Add 16+ tests for version resolution, deprecation handling, schema compatibility. Integration test: register v1 and v2 of query-context tool with schema changes, verify clients on each version get correct behavior. Reference api-conventions.md for MCP response structure.
- **Files**:
  - packages/semantic-core/src/mcp-tool-versioning.ts
  - packages/semantic-core/src/__tests__/mcp-tool-versioning.test.ts
  - apps/api/migrations/088_add_mcp_tool_versions.sql
  - apps/api/src/routes/mcp-tools.ts
  - apps/api/src/__tests__/mcp-tools.test.ts
  - apps/dashboard/app/admin/mcp-tools/page.tsx
  - apps/dashboard/components/mcp-tool-browser.tsx
  - apps/dashboard/components/tool-version-selector.tsx
  - apps/dashboard/components/schema-viewer.tsx
- **Depends on**: MCP Server Bootstrap (completed), Prefix Cache Manager (completed)
- **Added**: 2026-06-08

### Task: End-to-End Connector Monitoring & Health Scoring System
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a comprehensive health monitoring system for all connectors with proactive alerting and automated recovery. Create packages/semantic-core/src/connector-health-scorer.ts with ConnectorHealthScorer class: (1) scoreConnector(connectorId) computing a 0-100 health score from sync success rate (40%), entity freshness (30%), error frequency (20%), auth validity (10%), (2) detectDegradation(connectorId) comparing current score to 7-day rolling baseline and alerting on >15% drop, (3) suggestRecovery(connectorId) recommending actions (re-auth, manual sync, pause, retry), (4) monitorAuthExpiry() proactively rotating OAuth tokens before expiry. Create apps/api/migrations/089_add_connector_health.sql with connector_health_scores, health_alerts, recovery_actions tables. Expose REST: GET /api/v1/connectors/:id/health (detailed score breakdown), GET /api/v1/connectors/:id/health-history (time series), POST /api/v1/connectors/:id/recovery-action (execute suggested action), GET /api/v1/health-alerts (active alerts across workspace). Build dashboard components: ConnectorHealthCard (showing score + mini chart) on connectors list, HealthDetailPanel with scoring breakdown and historical context, AlertsWidget with active alerts and manual action buttons. Add 14+ unit tests for scoring algorithms, degradation detection, recovery recommendations. Integration test: simulate connector failure (API down), verify health score drops, alert triggers, recovery suggestion appears. Reference code-style.md for structured logging of health events.
- **Files**:
  - packages/semantic-core/src/connector-health-scorer.ts
  - packages/semantic-core/src/__tests__/connector-health-scorer.test.ts
  - packages/semantic-core/src/__tests__/connector-health-scorer.integration.test.ts
  - apps/api/migrations/089_add_connector_health.sql
  - apps/api/src/routes/connector-health.ts
  - apps/api/src/__tests__/connector-health.test.ts
  - apps/dashboard/components/connector-health-card.tsx
  - apps/dashboard/components/health-detail-panel.tsx
  - apps/dashboard/components/health-alerts-widget.tsx
- **Depends on**: Connector Registry (completed), Indexer Implementation (completed)
- **Added**: 2026-06-08

### Task: API Rate Limiting & Quota Management System
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive rate limiting and quota management for the REST API and MCP server to prevent abuse and enforce fair usage. Create packages/semantic-core/src/rate-limiter.ts with RateLimitService: (1) enforceRateLimit(workspaceId, endpoint, limit, windowMs) tracking requests per workspace per endpoint with sliding window algorithm, (2) getQuotaStatus(workspaceId) returning current usage vs. tier limits (free/pro/enterprise), (3) handleQuotaExhausted() returning 429 with retry-after header. Create apps/api/migrations/090_add_rate_limiting.sql with rate_limit_configs, quota_usage, quota_reset_events tables. Integrate middleware into Hono app for all /api/v1/* routes. MCP server enforces limits per API key. Expose REST: GET /api/v1/usage (current usage), GET /api/v1/limits (tier limits), POST /api/v1/limits/increase-request (request quota increase). Build dashboard page apps/dashboard/app/settings/[workspaceId]/usage-limits/page.tsx with usage charts, tier selector, quota upgrade flow. Add 16+ unit tests for sliding window, quota calculation, tier enforcement. Integration test: simulate 1000+ requests, verify rate limit kicks in at threshold, 429s returned. Reference api-conventions.md for status codes.
- **Files**:
  - packages/semantic-core/src/rate-limiter.ts
  - packages/semantic-core/src/__tests__/rate-limiter.test.ts
  - packages/semantic-core/src/__tests__/rate-limiter.integration.test.ts
  - apps/api/migrations/090_add_rate_limiting.sql
  - apps/api/src/middleware/rate-limiting.ts
  - apps/api/src/routes/usage-limits.ts
  - apps/api/src/__tests__/usage-limits.test.ts
  - apps/dashboard/app/settings/[workspaceId]/usage-limits/page.tsx
  - apps/dashboard/components/usage-quota-card.tsx
- **Depends on**: API Server Bootstrap (completed)
- **Added**: 2026-06-08

### Task: Advanced Entity Search & Filtering Engine
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a sophisticated entity search and filtering system enabling users to query entities by attribute values, relationships, and metadata. Create packages/semantic-core/src/entity-search.ts with EntitySearchEngine: (1) parseFilterQuery(filterString) supporting filters like "type:contact email:*@acme.com status:active", (2) buildSqlQuery(filters) generating safe parameterized SQL for Postgres, (3) searchEntities(workspaceId, query, filters, limit, cursor) combining full-text search and attribute filtering, (4) suggestFilters(query) returning applicable filters based on query context. Expose REST: POST /api/v1/entities/search with json body {query, filters, limit, cursor}, GET /api/v1/entities/search-suggestions (auto-complete filters). Build dashboard search page apps/dashboard/app/search/advanced/page.tsx with filter builder UI, multi-filter AND/OR logic, result counts, saved search ability. Support faceted search with counts per attribute value. Add 18+ unit tests for filter parsing, SQL generation safety (injection), complex filter combinations. Integration test: search 5000+ indexed entities with 10-filter combinations, verify accuracy and <500ms response. Reference code-style.md for SQL escaping patterns.
- **Files**:
  - packages/semantic-core/src/entity-search.ts
  - packages/semantic-core/src/__tests__/entity-search.test.ts
  - packages/semantic-core/src/__tests__/entity-search.integration.test.ts
  - apps/api/src/routes/entity-search.ts
  - apps/api/src/__tests__/entity-search.test.ts
  - apps/dashboard/app/search/advanced/page.tsx
  - apps/dashboard/components/filter-builder.tsx
  - apps/dashboard/components/search-results-table.tsx
  - apps/dashboard/components/faceted-search-sidebar.tsx
- **Depends on**: Semantic Index (completed), PgvectorStore (completed)
- **Added**: 2026-06-08

### Task: Comprehensive Load Testing & Performance Baseline Suite
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create a load testing and performance benchmarking suite to establish baseline metrics and validate system capacity. Build tests/load/ with k6 or Artillery scripts: (1) api-stress-test.js — concurrent requests to /api/v1/query-context, measure p50/p95/p99 latencies at 10, 50, 100, 500 RPS, (2) mcp-throughput-test.js — parallel MCP tool invocations, measure tool response latencies and cache hit rates under load, (3) sync-concurrency-test.js — parallel connector syncs (3+ connectors), measure queue throughput and peak memory, (4) index-query-test.js — vector search performance on 100K+ indexed entities with varying query complexities. Create monitoring dashboard tracking test results over time. Output performance report with: latency percentiles, throughput, error rates, memory/CPU peak, cache effectiveness. Establish baseline thresholds: p95 API latency <2s (cache miss), p95 MCP tool latency <500ms (cached), sync throughput ≥100 entities/sec. Create CI/CD integration to run on merges and alert on regressions. Document baseline results in docs/PERFORMANCE_BASELINE.md. Add recommendations for scaling (batch sizes, parallelism, caching). Reference connector-patterns.md for sync generator patterns during load.
- **Files**:
  - tests/load/api-stress-test.js
  - tests/load/mcp-throughput-test.js
  - tests/load/sync-concurrency-test.js
  - tests/load/index-query-test.js
  - tests/load/load-test-config.ts
  - tests/load/__tests__/load-test-results.test.ts
  - docs/PERFORMANCE_BASELINE.md
  - .github/workflows/load-testing.yml
- **Depends on**: MCP Server Bootstrap (completed), API Server Bootstrap (completed), Indexer Implementation (completed)
- **Added**: 2026-06-08

### Task: Webhook Management & Testing Dashboard
- **Layer**: 54 — Connector Expansion & V1 Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a user-facing dashboard for managing webhooks, testing webhook delivery, and debugging payload issues. Create apps/dashboard/app/admin/webhooks/page.tsx with: (1) WebhookListTable showing all configured webhooks (URL, trigger events, active status, last delivery), (2) WebhookEventLog showing recent deliveries with status, latency, response code, (3) WebhookTestPanel allowing manual delivery of sample payloads and inspecting responses, (4) WebhookRetryQueue managing failed deliveries with manual retry. Add Webhook admin routes at apps/api/src/routes/webhook-admin.ts: GET /api/v1/admin/webhooks (list with pagination), GET /api/v1/admin/webhooks/:id/deliveries (event log), POST /api/v1/admin/webhooks/:id/test-delivery (test fire), POST /api/v1/admin/webhooks/:id/retry/:deliveryId (manual retry). Create packages/semantic-core/src/webhook-debugger.ts with WebhookDebugger: capturePayloads, comparePayloads (expected vs. actual), validateSignature (HMAC-SHA256). Build dashboard component WebhookDebugger showing request/response diff, signature validation status. Add 14+ tests for webhook debugging logic, signature validation, delivery retry logic. Integration test: send 10 webhooks, simulate 2 failures, retry, verify success. Reference api-conventions.md for REST design, code-style.md for error handling.
- **Files**:
  - apps/dashboard/app/admin/webhooks/page.tsx
  - apps/dashboard/components/webhook-list-table.tsx
  - apps/dashboard/components/webhook-event-log.tsx
  - apps/dashboard/components/webhook-test-panel.tsx
  - apps/dashboard/components/webhook-retry-queue.tsx
  - apps/dashboard/components/webhook-debugger.tsx
  - apps/api/src/routes/webhook-admin.ts
  - apps/api/src/__tests__/webhook-admin.test.ts
  - packages/semantic-core/src/webhook-debugger.ts
  - packages/semantic-core/src/__tests__/webhook-debugger.test.ts
- **Depends on**: Webhook-driven Real-Time Sync (completed)
- **Added**: 2026-06-08

---

## Layer 55: Growth Phase V2 Features & Advanced Analytics

### Task: Data Lineage Tracking & Impact Analysis Engine
- **Layer**: 55 — Growth Phase V2 Features & Advanced Analytics
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive data lineage tracking to show where entities originate, how they transform, and downstream impacts. Create packages/semantic-core/src/data-lineage.ts with DataLineageEngine: (1) trackEntityOrigin(entityId) returning source connector and ingestion timestamp, (2) buildTransformationChain(entityId) showing all transformations applied (enrichment, linking, deduplication), (3) getDownstreamImpact(entityId) finding all entities that reference this entity and MCP queries that return it, (4) analyzeChangePropagation(entityId, changeType) modeling impact if entity is deleted/updated. Create apps/api/migrations/091_add_data_lineage.sql with: entity_lineage (entity_id, source_connector_id, source_record_id, ingestion_at), entity_transformations (entity_id, transformation_type, input_entity_ids, output_attributes, applied_at), query_entity_map (query_id, entity_id, context_position, accessed_at) for audit. Expose REST: GET /api/v1/entities/:id/lineage (full lineage chain), GET /api/v1/entities/:id/impact (what depends on this), POST /api/v1/lineage/change-impact (simulate change and show impact). Build dashboard page apps/dashboard/app/admin/data-lineage/page.tsx with: interactive lineage flow diagram (source → transformations → usage), impact radius visualization showing affected queries/entities, change impact simulator with preview. Add 16+ unit tests for lineage chain building, impact calculation, transformation tracking. Integration test: index 500 entities with cross-connector relationships, verify lineage traces correctly through 3+ transformation steps. Reference code-style.md for structured logging.
- **Files**:
  - packages/semantic-core/src/data-lineage.ts
  - packages/semantic-core/src/__tests__/data-lineage.test.ts
  - packages/semantic-core/src/__tests__/data-lineage.integration.test.ts
  - apps/api/migrations/091_add_data_lineage.sql
  - apps/api/src/routes/data-lineage.ts
  - apps/api/src/__tests__/data-lineage.test.ts
  - apps/dashboard/app/admin/data-lineage/page.tsx
  - apps/dashboard/components/lineage-flow-diagram.tsx
  - apps/dashboard/components/impact-visualizer.tsx
- **Depends on**: Entity Schema & Transformation (completed), Semantic Index (completed)
- **Added**: 2026-06-08

### Task: Intelligent Query Optimizer & Execution Planner
- **Layer**: 55 — Growth Phase V2 Features & Advanced Analytics
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build query optimization engine that analyzes incoming requests and automatically selects optimal execution strategy (vector search vs. graph expansion vs. cache vs. hybrid). Create packages/semantic-core/src/query-optimizer.ts with QueryOptimizer: (1) analyzeQueryPattern(query, filters, context) estimating selectivity, expected result set size, likelihood of cache hit, (2) selectExecutionStrategy(analysis) choosing between: vector_search_only, graph_expansion_first, cache_check_first, parallel_hybrid (execute multiple in parallel), (3) estimateCost(strategy, workspaceId) predicting tokens, API calls, latency based on historical metrics, (4) buildExecutionPlan(query, strategy) returning ordered steps with fallbacks. Create apps/api/migrations/092_add_query_optimization.sql with: query_execution_plans (query_hash, strategy_chosen, estimated_cost_tokens, actual_cost_tokens, latency_ms, cache_hit, created_at) for learning. Integrate with retrieval engine to use plans. Expose REST: POST /api/v1/queries/optimize (explain query plan), GET /api/v1/query-optimizer/stats (show optimizer effectiveness). Build dashboard panel apps/dashboard/components/query-optimizer-panel.tsx showing: current queries being optimized, execution strategy breakdown (% using each strategy), cost prediction vs. actual histogram, slowest queries and their plans. Add 18+ unit tests for selectivity estimation, strategy selection, cost prediction accuracy. Integration test: run 1000 queries with diverse patterns, verify optimizer selections improve latency/cost by ≥15% vs. default strategy. Reference code-style.md for logging decisions.
- **Files**:
  - packages/semantic-core/src/query-optimizer.ts
  - packages/semantic-core/src/__tests__/query-optimizer.test.ts
  - packages/semantic-core/src/__tests__/query-optimizer.integration.test.ts
  - apps/api/migrations/092_add_query_optimization.sql
  - apps/api/src/routes/query-optimization.ts
  - apps/api/src/__tests__/query-optimization.test.ts
  - apps/dashboard/components/query-optimizer-panel.tsx
- **Depends on**: Retrieval Engine (completed), Advanced Query Engine (completed)
- **Added**: 2026-06-08

### Task: Semantic Query Learning & Proactive Suggestion Engine
- **Layer**: 55 — Growth Phase V2 Features & Advanced Analytics
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a learning system that observes successful queries and suggests optimizations, new queries users might want, and potential data enrichments. Create packages/semantic-core/src/query-learning-engine.ts with QueryLearningEngine: (1) learnFromSuccessfulQueries(workspaceId, queryHistory) analyzing patterns (entity types queried together, filters commonly applied, time-of-day patterns) and building a query suggestion model, (2) suggestRelatedQueries(currentQuery) returning semantically similar queries other users ran that succeeded, (3) suggestMissingContext(query, results) identifying attributes frequently co-queried with the current entity type that weren't in the result, (4) recommendIndexExpansion(workspaceId) suggesting new entity types or connectors to onboard based on gap analysis of queries. Create apps/api/migrations/093_add_query_learning.sql with: query_patterns (workspace_id, query_hash, entity_types_queried, filters_used, avg_result_size, success_rate, similar_queries), missing_context_candidates (workspace_id, entity_type, attribute, suggestion_confidence, use_case). Expose REST: GET /api/v1/queries/suggestions (suggest next query), GET /api/v1/queries/:id/missing-context (show gaps), GET /api/v1/workspaces/:id/index-expansion-recommendations (suggest connectors). Build dashboard page apps/dashboard/app/insights/query-recommendations/page.tsx with: suggested queries widget (your team's top patterns), potential context additions (missing attributes), connector expansion recommendations with ROI estimates. Add 14+ unit tests for pattern detection, similarity scoring, suggestion ranking. Integration test: simulate 500 diverse queries, verify suggestions include relevant patterns from first 100 queries when predicting queries 101-500. Reference embedding-patterns.md for semantic similarity calculation.
- **Files**:
  - packages/semantic-core/src/query-learning-engine.ts
  - packages/semantic-core/src/__tests__/query-learning-engine.test.ts
  - packages/semantic-core/src/__tests__/query-learning-engine.integration.test.ts
  - apps/api/migrations/093_add_query_learning.sql
  - apps/api/src/routes/query-learning.ts
  - apps/api/src/__tests__/query-learning.test.ts
  - apps/dashboard/app/insights/query-recommendations/page.tsx
  - apps/dashboard/components/query-suggestions-widget.tsx
  - apps/dashboard/components/missing-context-advisor.tsx
- **Depends on**: Advanced Entity Search (completed), Query Analytics Engine (completed)
- **Added**: 2026-06-08

### Task: Enterprise Compliance & Fine-Grained Audit Export
- **Layer**: 55 — Growth Phase V2 Features & Advanced Analytics
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance audit capabilities for enterprise compliance (SOC 2, HIPAA, GDPR) with structured export, signed timestamps, and detailed access tracking. Create packages/semantic-core/src/compliance-auditor.ts with ComplianceAuditor: (1) generateAuditReport(workspaceId, startDate, endDate, includeFieldAccessPatterns) exporting CSV/JSON with: user_id, entity_ids accessed, timestamp, ip_address, user_agent, query_text, result_count, pii_fields_accessed (yes/no), action (read/write/delete), (2) signAuditLog(report) using RSA-2048 to sign report, prevent tampering, (3) detectAnomalousAccess(workspaceId, days=30) flagging suspicious patterns (off-hours access, bulk entity downloads, repeated PII field access by non-authorized users), (4) exportToComplianceFormat(workspaceId, format) supporting SOC 2 template, GDPR access request format, HIPAA audit requirements. Create apps/api/migrations/094_add_compliance_audit.sql with: signed_audit_exports (workspace_id, export_id, date_range, signature, signed_at, requested_by_user_id, tamper_check_status), anomalous_access_alerts (workspace_id, alert_type: 'bulk_access'|'off_hours'|'pii_overaccess', user_id, entity_ids_involved, confidence, flagged_at). Expose REST: POST /api/v1/compliance/audit-export (generate report with signature), GET /api/v1/compliance/audit-exports (list historical exports), GET /api/v1/compliance/anomalies (suspicious access patterns), GET /api/v1/compliance/verify-export/:exportId (verify signature). Build dashboard page apps/dashboard/app/admin/compliance/page.tsx with: audit export wizard, signature verification UI, anomaly alerts list with investigation tools, GDPR data access report generator. Add 15+ unit tests for audit generation, signature verification, anomaly detection heuristics. Integration test: generate 1000 audit entries with seeded anomalies, verify detection catches 95%+ of synthetic anomalies, signature verification succeeds on authentic reports and fails on tampered. Reference code-style.md for crypto handling.
- **Files**:
  - packages/semantic-core/src/compliance-auditor.ts
  - packages/semantic-core/src/__tests__/compliance-auditor.test.ts
  - packages/semantic-core/src/__tests__/compliance-auditor.integration.test.ts
  - apps/api/migrations/094_add_compliance_audit.sql
  - apps/api/src/routes/compliance-audit.ts
  - apps/api/src/__tests__/compliance-audit.test.ts
  - apps/dashboard/app/admin/compliance/page.tsx
  - apps/dashboard/components/audit-export-wizard.tsx
  - apps/dashboard/components/anomaly-alerts-list.tsx
- **Depends on**: Audit Logger (completed), Role-Based Context Segmentation (completed)
- **Added**: 2026-06-08

---

## Layer 56: Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization

### Task: GraphQL API Gateway & Schema Federation
- **Layer**: 56 — Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a GraphQL API gateway alongside the existing REST API to enable efficient, query-optimized data fetching for advanced clients. Create packages/semantic-core/src/graphql-schema.ts with buildGraphQLSchema() generating a federated schema supporting: Query root (entity, entities, metrics, glossary, lineage), Mutation root (createEntity, updateEntity, deleteEntity, runQuery), Subscription root (onEntityChanged, onMetricUpdated, onSyncProgress) using GraphQL subscriptions. Implement packages/semantic-core/src/graphql-resolver.ts with resolvers delegating to existing semantic-core services (retrieval, indexer, metrics). Expose apps/api/src/routes/graphql.ts using apollo-server-hono with authentication, authorization (workspace/role-based), and token budget enforcement per query. Add GraphQL introspection debugging tools. Create apps/api/migrations/095_add_graphql_audit.sql with graphql_queries (workspace_id, query_hash, operation_name, query_cost_tokens, execution_time_ms, error, user_id, accessed_at). Build dashboard page apps/dashboard/app/admin/graphql-explorer/page.tsx with interactive GraphQL IDE (query editor, docs sidebar, results). Add 18+ unit tests covering: schema generation, resolver delegation, subscription filtering, complex nested queries, authorization enforcement, token budget limits. Integration test: 500 diverse GraphQL queries against 1000 indexed entities, verify subscription notifications fire correctly for entity changes. Reference api-conventions.md for GraphQL patterns.
- **Files**:
  - packages/semantic-core/src/graphql-schema.ts
  - packages/semantic-core/src/graphql-resolver.ts
  - packages/semantic-core/src/__tests__/graphql-schema.test.ts
  - packages/semantic-core/src/__tests__/graphql-resolver.test.ts
  - apps/api/src/routes/graphql.ts
  - apps/api/src/__tests__/graphql.test.ts
  - apps/api/migrations/095_add_graphql_audit.sql
  - apps/dashboard/app/admin/graphql-explorer/page.tsx
  - apps/dashboard/components/graphql-query-builder.tsx
- **Depends on**: API Server Bootstrap (completed), Advanced Query Engine (completed)
- **Added**: 2026-06-08

### Task: SCIM 2.0 User Provisioning & Directory Sync
- **Layer**: 56 — Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement System for Cross-domain Identity Management (SCIM 2.0) protocol for enterprise directory integration (Azure AD, Okta, Google Workspace). Create packages/semantic-core/src/scim-provisioner.ts with SCIMProvisionerService: (1) parseIncomingRequest(method, path, body) validating SCIM requests per RFC 7644, (2) provisionUser(scimUser) creating/updating workspace members from directory push events, (3) provisionGroup(scimGroup) mapping directory groups to Iris role groups, (4) handleDeprovision(userId) revoking access when user deleted from directory, (5) getFilteredUsers(filter) and getFilteredGroups(filter) for pull-based sync. Create apps/api/migrations/096_add_scim.sql with: scim_provisioned_users (user_id, external_user_id, directory_type, synced_at, last_updated), scim_group_mappings (group_name, iris_role, directory_type). Expose REST endpoints: /api/v1/scim/v2/Users (GET/POST), /api/v1/scim/v2/Users/:id (GET/PUT/DELETE), /api/v1/scim/v2/Groups (GET/POST), /api/v1/scim/v2/Groups/:id (GET/PUT/DELETE). Support filtering, pagination per SCIM spec. Emit audit events for all provisioning actions. Build admin UI: apps/dashboard/app/settings/[workspaceId]/directory/page.tsx showing: active directory type, sync status, last sync time, error logs, manual sync trigger. Add 16+ unit tests for: SCIM request parsing, user creation/update/delete workflows, group mappings, filter parsing, role assignment. Integration test: simulate Okta/Azure webhook events for 100 users, verify all create/update/delete operations succeed with correct Iris roles assigned. Reference code-style.md for SCIM RFC compliance.
- **Files**:
  - packages/semantic-core/src/scim-provisioner.ts
  - packages/semantic-core/src/__tests__/scim-provisioner.test.ts
  - packages/semantic-core/src/__tests__/scim-provisioner.integration.test.ts
  - apps/api/src/routes/scim.ts
  - apps/api/src/__tests__/scim.test.ts
  - apps/api/migrations/096_add_scim.sql
  - apps/dashboard/app/settings/[workspaceId]/directory/page.tsx
  - apps/dashboard/components/scim-sync-status.tsx
- **Depends on**: Role-Based Context Segmentation (completed), Session Management (completed)
- **Added**: 2026-06-08

### Task: Cache Prewarming & Predictive Context Loading Engine
- **Layer**: 56 — Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an intelligent cache prewarming system that predicts which contexts will be needed and loads them proactively into the semantic cache and Redis. Create packages/semantic-core/src/cache-prewarmer.ts with CachePrewarmingEngine: (1) analyzeQueryPatterns(workspaceId, days=7) learning which entity types and metrics are queried together and at what times, (2) predictNextContext(currentQuery) predicting entities the user will ask about next based on co-occurrence patterns, (3) preloadToCache(entityIds, ttl) warming semantic cache for predicted entities, (4) measurePrefixCacheHits(workspaceId) tracking improvement from prewarming. Create apps/api/migrations/097_add_cache_warming.sql with: cache_prewarming_stats (workspace_id, predicted_entity_ids, loaded_count, actual_cache_hit_count, accuracy_ratio, measured_at). Integrate with indexer: on each sync completion, run prewarming predictions for top users. Expose REST: GET /api/v1/cache/prewarming-stats (show effectiveness), POST /api/v1/cache/preload (manual preload for specific entity types). Build dashboard widgets: apps/dashboard/components/cache-effectiveness-chart.tsx (showing cache hit ratio before/after prewarming), cache-warming-status.tsx (live status of warming jobs). Add 14+ unit tests for: pattern analysis, co-occurrence scoring, predictive accuracy, cache invalidation on data changes. Integration test: index 5000 entities, run 1000 queries with learned patterns, verify cache hit ratio improves by ≥25% and p95 latency improves by ≥30% when warming is active vs disabled. Reference embedding-patterns.md for similarity calculations.
- **Files**:
  - packages/semantic-core/src/cache-prewarmer.ts
  - packages/semantic-core/src/__tests__/cache-prewarmer.test.ts
  - packages/semantic-core/src/__tests__/cache-prewarmer.integration.test.ts
  - apps/api/src/routes/cache-prewarming.ts
  - apps/api/src/__tests__/cache-prewarming.test.ts
  - apps/api/migrations/097_add_cache_warming.sql
  - apps/dashboard/components/cache-effectiveness-chart.tsx
  - apps/dashboard/components/cache-warming-status.tsx
- **Depends on**: Semantic Cache (completed), Query Analytics Engine (completed)
- **Added**: 2026-06-08

### Task: Advanced Multi-LLM Cost Optimizer & Provider Router
- **Layer**: 56 — Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance the multi-LLM router to optimize cost across providers (Anthropic, OpenAI, Azure, Gemini) by analyzing query characteristics and selecting the cheapest provider that meets accuracy requirements. Create packages/semantic-core/src/llm-cost-optimizer.ts with LLMCostOptimizer: (1) classifyQueryComplexity(query, context) scoring complexity 1-10 based on entity count, relationship depth, required context size, (2) estimateTokenUsage(provider, query, context) calling provider APIs to predict token usage before committing, (3) rankProvidersByValue(complexity, requirements) scoring each provider on cost/speed/accuracy tradeoff, (4) selectOptimalProvider(query, workspace, budget) returning chosen provider with confidence score, (5) trackProviderAccuracy(provider, query, userFeedback) measuring actual accuracy for cost-optimization model improvement. Create apps/api/migrations/098_add_llm_cost_optimization.sql with: llm_cost_estimates (workspace_id, query_hash, provider, estimated_tokens, actual_tokens, cost_cents, execution_time_ms, user_satisfaction_score), provider_accuracy_baseline (provider, query_complexity_range, accuracy_score, confidence, measured_at). Integrate with query-context MCP tool: use optimizer to select provider for each query. Expose REST: POST /api/v1/llm-routing/estimate-cost (predict cost for query), GET /api/v1/llm-routing/recommendations (suggested providers for workspace), GET /api/v1/llm-routing/accuracy-baselines (show provider accuracy by complexity). Build dashboard: apps/dashboard/app/settings/[workspaceId]/llm-routing/page.tsx with: provider cost comparison, accuracy-by-complexity matrix, optimization recommendations, cost savings trend. Add 16+ unit tests for: complexity classification, token estimation accuracy, provider scoring, accuracy tracking. Integration test: run 500 queries across all 4 major providers, verify selected providers have ≥95% cost accuracy and maintain ≥98% user satisfaction.
- **Files**:
  - packages/semantic-core/src/llm-cost-optimizer.ts
  - packages/semantic-core/src/__tests__/llm-cost-optimizer.test.ts
  - packages/semantic-core/src/__tests__/llm-cost-optimizer.integration.test.ts
  - apps/api/src/routes/llm-cost-optimization.ts
  - apps/api/src/__tests__/llm-cost-optimization.test.ts
  - apps/api/migrations/098_add_llm_cost_optimization.sql
  - apps/dashboard/app/settings/[workspaceId]/llm-routing/page.tsx
  - apps/dashboard/components/provider-cost-comparison.tsx
- **Depends on**: Multi-LLM Router (completed), Query Analytics Engine (completed)
- **Added**: 2026-06-08

### Task: Workspace Federation & Cross-Tenant Data Sharing
- **Layer**: 56 — Growth Phase V2 - Advanced Infrastructure & Enterprise Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enable secure cross-workspace federation for agencies, holding companies, and partner networks that need to query related data from sibling workspaces with fine-grained access control. Create packages/semantic-core/src/federation-manager.ts with FederationManager: (1) registerFederatedWorkspace(sourceWorkspace, targetWorkspace, permissions) establishing trust relationship between workspaces, (2) queryFederatedContext(query, sourceworkspaceId, allowedTargetWorkspaces) executing queries across workspace boundaries with permission enforcement, (3) mergeFederatedResults(results, maxTokenBudget) combining results from multiple workspaces and applying compression to fit budget, (4) auditFederatedAccess(queryId, sourceWorkspace, queriedWorkspaces) logging all cross-workspace queries. Create apps/api/migrations/099_add_federation.sql with: federated_relationships (source_workspace_id, target_workspace_id, relationship_type: 'parent_child'|'sibling'|'partner', created_by_user_id, trusted_at), federation_permissions (relationship_id, entity_type_pattern, read|write, created_at). Add new MCP tool: query-federated-context (parameters: query, federatedWorkspaceIds, maxTokenBudget) returning merged, deduplicated, permission-filtered context from multiple workspaces. Build admin UI: apps/dashboard/app/settings/[workspaceId]/federation/page.tsx showing: federated relationships, per-workspace permissions, federation access audit log. Add 15+ unit tests for: permission enforcement, result merging, deduplication across workspaces, token budget enforcement. Integration test: create 5 federated workspaces, run queries with shared relationships, verify correct permission boundaries, token budgets respected, results properly merged. Reference api-conventions.md for MCP tool patterns, code-style.md for auth.
- **Files**:
  - packages/semantic-core/src/federation-manager.ts
  - packages/semantic-core/src/__tests__/federation-manager.test.ts
  - packages/semantic-core/src/__tests__/federation-manager.integration.test.ts
  - apps/api/src/routes/federation.ts
  - apps/api/src/__tests__/federation.test.ts
  - apps/api/migrations/099_add_federation.sql
  - apps/mcp-server/src/tools/query-federated-context.ts
  - apps/dashboard/app/settings/[workspaceId]/federation/page.tsx
- **Depends on**: Multi-tenant support (completed), Role-Based Context Segmentation (completed)
- **Added**: 2026-06-08

---

## Layer 57: Scale Phase III - Advanced Intelligence & Context Optimization

### Task: Context Versioning & Time-Travel Query Engine
- **Layer**: 57 — Scale Phase III - Advanced Intelligence & Context Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a context versioning system enabling users to query business context as it existed at a previous point in time, with full audit of what changed and when. Create packages/semantic-core/src/context-versioner.ts with ContextVersionManager: (1) captureContextSnapshot(workspaceId, snapshotKey) creating immutable point-in-time index state with gzip compression, (2) queryAsOfDate(workspaceId, query, targetDate, contextBudget) executing queries against a historical snapshot, (3) diffContextVersions(versionA, versionB) showing what entities/metrics changed between two points, (4) rollbackToVersion(workspaceId, versionId) reverting index to previous state (admin-only with confirmation), (5) listVersionHistory(workspaceId, limit) with cursor pagination. Create apps/api/migrations/100_add_context_versioning.sql with: context_snapshots (workspace_id, snapshot_id, snapshot_key, captured_at, data_size_bytes, gzip_size_bytes, entity_count, checksum), version_diffs (workspace_id, from_version_id, to_version_id, changed_entity_ids, change_types: 'created'|'updated'|'deleted', diff_summary). Expose REST: POST /api/v1/context/snapshots (capture now), GET /api/v1/context/snapshots (list versions), POST /api/v1/context/query-as-of (query historical), GET /api/v1/context/versions/:id/diff (compare versions), GET /api/v1/context/audit/changes (what changed when). Add MCP tool: query-context-at-date (parameters: query, targetDate, federatedWorkspaceIds, maxTokenBudget). Build dashboard: apps/dashboard/app/context-versioning/page.tsx with timeline selector, version list, diff viewer showing side-by-side entity changes, rollback confirmation UI. Add 16+ unit tests for: snapshot capture/compression, time-travel query accuracy, diff calculation, version rollback, edge cases (rollback with active queries). Integration test: capture 5 snapshots over time, run 20 queries at different dates, verify results match historical state, diff calculations 100% accurate. Reference code-style.md for error handling and api-conventions.md for REST design.
- **Files**:
  - packages/semantic-core/src/context-versioner.ts
  - packages/semantic-core/src/__tests__/context-versioner.test.ts
  - packages/semantic-core/src/__tests__/context-versioner.integration.test.ts
  - apps/api/src/routes/context-versioning.ts
  - apps/api/src/__tests__/context-versioning.test.ts
  - apps/api/migrations/100_add_context_versioning.sql
  - apps/mcp-server/src/tools/query-context-at-date.ts
  - apps/dashboard/app/context-versioning/page.tsx
  - apps/dashboard/components/version-timeline.tsx
  - apps/dashboard/components/context-diff-viewer.tsx
- **Depends on**: Workspace Federation & Cross-Tenant Data Sharing (in progress)
- **Added**: 2026-06-08

### Task: Intelligent Context Summarization Engine with Task-Specific Ranking
- **Layer**: 57 — Scale Phase III - Advanced Intelligence & Context Optimization
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a dynamic context summarization system that generates provider-specific and task-aware summaries, adapting detail level and structure based on the LLM's capabilities and the query's intent. Create packages/semantic-core/src/context-summarizer.ts with ContextSummarizer: (1) classifyQueryIntent(query) detecting if task is 'analytical'|'operational'|'reporting'|'synthesis', (2) rankContextByTaskRelevance(entities, intent, workspaceSchema) scoring context importance 0-1 based on entity type, relationships, frequency in similar queries, (3) generateTaskSpecificSummary(context, modelCapability, targetTokens) creating summaries from verbose (GPT-4, 2000 tokens) to minimal (GPT-3.5, 500 tokens) with per-provider optimizations: Anthropic Claude prefers structured bullet lists, OpenAI prefers JSON, Gemini prefers conversational prose, (4) optimizeSummaryStructure(summary, format) serializing for token efficiency per LLM provider format rules. Create apps/api/migrations/101_add_context_summarization.sql with: summarization_styles (workspace_id, query_intent_pattern, preferred_style, applied_count), summary_metrics (workspace_id, original_token_count, summary_token_count, compression_ratio, user_satisfaction_score, generated_at). Integrate with query-context MCP tool: after retrieval, run summarizer before sending to LLM, pass intent through MCP context. Expose REST: POST /api/v1/context/summarize (create summary for given intent/budget), GET /api/v1/summarization/metrics (compression ratio and effectiveness). Build dashboard widgets: apps/dashboard/components/context-summary-preview.tsx (show original vs. summarized side-by-side), summarization-stats.tsx (compression ratios by intent type). Add 14+ unit tests for: intent classification accuracy, relevance ranking, per-provider format optimization, token budget enforcement, compression ratio measurements. Integration test: run 200 queries with diverse intents and LLM providers, measure token savings (target ≥40% vs. uncompressed) and verify user satisfaction scores ≥4/5. Reference embedding-patterns.md for relevance calculations, api-conventions.md for MCP tool patterns.
- **Files**:
  - packages/semantic-core/src/context-summarizer.ts
  - packages/semantic-core/src/__tests__/context-summarizer.test.ts
  - packages/semantic-core/src/__tests__/context-summarizer.integration.test.ts
  - apps/api/src/routes/context-summarization.ts
  - apps/api/src/__tests__/context-summarization.test.ts
  - apps/api/migrations/101_add_context_summarization.sql
  - apps/dashboard/components/context-summary-preview.tsx
  - apps/dashboard/components/summarization-stats.tsx
- **Depends on**: Advanced Multi-LLM Cost Optimizer & Provider Router (completed)
- **Added**: 2026-06-08

### Task: Relationship Inference & Hidden Link Discovery Engine
- **Layer**: 57 — Scale Phase III - Advanced Intelligence & Context Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an ML-based relationship inference system that detects hidden or implicit relationships between entities and automatically suggests missing links in the knowledge graph. Create packages/semantic-core/src/relationship-inference.ts with RelationshipInferenceEngine: (1) buildCooccurrenceMatrix(workspaceId, days=90) analyzing entity co-occurrence in queries/contexts, (2) detectImplicitRelationships(sourceEntity, targetEntity) scoring likelihood of a relationship (0-1) based on: semantic similarity, co-occurrence frequency, connector metadata patterns, entity type compatibility rules, (3) predictMissingRelationships(entity, topK) returning top K likely-missing relationships for an entity using collaborative filtering on entity embeddings, (4) validateInferredRelationship(relationship, confidence) before suggestion, enforcing minimum confidence threshold (0.75), (5) suggestRelationshipCreation(workspaceId, topK) returning top unconfirmed relationships to admin. Create apps/api/migrations/102_add_relationship_inference.sql with: inferred_relationships (source_entity_id, target_entity_id, relationship_type_predicted, confidence_score, discovery_method: 'cooccurrence'|'embedding_similarity'|'metadata_pattern', suggested_at, confirmed_at, rejected_at), relationship_inference_metrics (workspace_id, total_inferred, confirmed_count, accuracy_ratio, measured_at). Expose REST: GET /api/v1/graph/inferred-relationships (list suggested links with confidence), POST /api/v1/graph/inferred/:relId/confirm (admin accepts suggestion), POST /api/v1/graph/inferred/:relId/reject (admin rejects), POST /api/v1/graph/suggest-relationships (async job returning top candidates). Integrate with graph visualization: apps/dashboard/components/relationship-suggestions-panel.tsx showing confidence scores, discovery method, admin confirmation controls. Add 15+ unit tests for: co-occurrence matrix building, implicit relationship detection, confidence scoring, relationship validation, edge cases (circular suggestions, duplicate). Integration test: index 3000 entities with sparse relationships, run inference, validate ≥80% confirmed suggestions are semantically correct by manual review. Reference embedding-patterns.md for similarity calculations, code-style.md for ML model patterns.
- **Files**:
  - packages/semantic-core/src/relationship-inference.ts
  - packages/semantic-core/src/__tests__/relationship-inference.test.ts
  - packages/semantic-core/src/__tests__/relationship-inference.integration.test.ts
  - apps/api/src/routes/relationship-inference.ts
  - apps/api/src/__tests__/relationship-inference.test.ts
  - apps/api/migrations/102_add_relationship_inference.sql
  - apps/dashboard/components/relationship-suggestions-panel.tsx
- **Depends on**: Knowledge Graph Visualization Dashboard (completed)
- **Added**: 2026-06-08

### Task: Intelligent Query Clustering & Adaptive Cache TTL Engine
- **Layer**: 57 — Scale Phase III - Advanced Intelligence & Context Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an intelligent query clustering system that groups semantically similar queries and learns optimal cache TTL policies per cluster, improving cache hit rates through smarter invalidation. Create packages/semantic-core/src/query-cluster-engine.ts with QueryClusteringEngine: (1) clusterQueriesBySemanticSimilarity(workspaceId, days=7) using query embeddings + k-means (k=10-50 adaptive) to group similar queries, (2) extractClusterSignature(cluster) identifying: dominant entity types, query intent, update frequency patterns, (3) predictOptimalCacheTtl(cluster) learning from historical cache hit rates and data freshness: clusters querying stable reference data get longer TTL (24h), clusters querying high-velocity data get shorter TTL (5min), (4) detectCacheInvalidationPatterns(cluster) identifying: when updates to entity types in cluster trigger cascading invalidation, (5) adaptiveTtlAssignment(query) assigning TTL based on which cluster the query belongs to. Create apps/api/migrations/103_add_query_clustering.sql with: query_clusters (workspace_id, cluster_id, cluster_signature, member_count, dominant_entity_types, update_frequency_percentile, optimal_ttl_seconds, confidence_score, created_at), query_membership (query_hash, cluster_id, similarity_score), cache_invalidation_events (workspace_id, trigger_entity_type, affected_clusters, cascade_depth). Integrate with SemanticCache: on cache miss, use clustering to check sibling queries in cluster for recent hits. Expose REST: GET /api/v1/cache/clusters (show active clusters), GET /api/v1/cache/clusters/:id (cluster members + TTL strategy). Build dashboard: apps/dashboard/components/query-clustering-analysis.tsx (show clusters, member queries, TTL distribution, cache hit improvement). Add 14+ unit tests for: query clustering quality (silhouette score ≥0.6), TTL prediction accuracy, invalidation pattern detection, edge cases (single-query clusters, volatile data). Integration test: run 5000 queries over 7 days, cluster automatically, measure cache hit rate improvement (target ≥15% vs. uniform TTL). Reference embedding-patterns.md for query embedding generation.
- **Files**:
  - packages/semantic-core/src/query-cluster-engine.ts
  - packages/semantic-core/src/__tests__/query-cluster-engine.test.ts
  - packages/semantic-core/src/__tests__/query-cluster-engine.integration.test.ts
  - apps/api/src/routes/query-clustering.ts
  - apps/api/src/__tests__/query-clustering.test.ts
  - apps/api/migrations/103_add_query_clustering.sql
  - apps/dashboard/components/query-clustering-analysis.tsx
- **Depends on**: Semantic Cache (completed), Query Analytics Engine (completed)
- **Added**: 2026-06-08

### Task: MCP Tool Auto-Generation & Dynamic Schema Binding from Connectors
- **Layer**: 57 — Scale Phase III - Advanced Intelligence & Context Optimization
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a system that automatically generates MCP tools from connector schemas, enabling dynamic query capabilities without manual tool definition. Create packages/semantic-core/src/mcp-tool-generator.ts with MCPToolGenerator: (1) generateToolsFromConnectorSchema(connectorId, schema) creating tools for each entity type: query-<connector>-<entity> (e.g., query-hubspot-contact), list-<connector>-<entity>-metrics, (2) buildToolInputSchema(entitySchema) converting connector schema to zod validation, (3) bindToolToRetrieval(tool) connecting auto-gen tool to query-context retrieval engine with semantic filtering, (4) versionToolDefinition(toolId, newSchema) managing schema changes with backward-compatibility warnings, (5) validateToolUsage(toolId, input) runtime validation and error mapping. Create apps/api/migrations/104_add_auto_mcp_tools.sql with: auto_generated_tools (workspace_id, tool_id, source_connector_id, entity_type, tool_definition_json, version, generated_at, last_invoked_at), tool_version_history (tool_id, version, schema_changes, is_backward_compatible, deprecation_warning). Integrate with MCP server: on workspace load, scan enabled connectors, auto-generate tools, register in MCP server, emit schema to Claude. Expose REST: GET /api/v1/mcp/auto-tools (list auto-generated tools), GET /api/v1/mcp/auto-tools/:toolId/schema (tool schema), POST /api/v1/mcp/auto-tools/:toolId/test (dry-run tool with sample input). Build dashboard: apps/dashboard/components/auto-tool-registry.tsx (show all auto-generated tools, source connector, usage stats). Add 14+ unit tests for: schema-to-tool conversion, zod validation generation, backward-compatibility detection, tool registration, version migration. Integration test: enable 5 connectors with 40+ entity types total, auto-generate tools, invoke 50 different auto-gen tools via MCP, verify all succeed and schema validation blocks invalid inputs. Reference api-conventions.md for MCP tool patterns, code-style.md for schema validation.
- **Files**:
  - packages/semantic-core/src/mcp-tool-generator.ts
  - packages/semantic-core/src/__tests__/mcp-tool-generator.test.ts
  - packages/semantic-core/src/__tests__/mcp-tool-generator.integration.test.ts
  - apps/api/src/routes/mcp-auto-tools.ts
  - apps/api/src/__tests__/mcp-auto-tools.test.ts
  - apps/api/migrations/104_add_auto_mcp_tools.sql
  - apps/mcp-server/src/tools/auto-tool-registry.ts
  - apps/dashboard/components/auto-tool-registry.tsx
- **Depends on**: MCP Tool Versioning & Backwards Compatibility Manager (completed)
- **Added**: 2026-06-08

---

## Layer 58: Growth Phase II - Real-Time & Agent Learning

### Task: Event-Driven Real-Time Sync Engine with Pub/Sub Integration
- **Layer**: 58 — Growth Phase II - Real-Time & Agent Learning
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a full event-driven real-time sync system that allows connectors to emit change events that are immediately processed and indexed, eliminating polling delays. Create packages/semantic-core/src/event-driven-sync-engine.ts with EventDrivenSyncEngine: (1) createPublisher(connectorId, workspaceId) establishing a connector-scoped pub/sub channel for emitting EntityChangeEvent, (2) subscribeToConnectorEvents(connectorId, handler) setting up Redis pub/sub subscription with auto-reconnect, (3) processChangeEvent(event) immediately: validating against connector schema, enriching with relationships, indexing to vector store, invalidating related cache keys, (4) batchProcessEvents(events, timeWindowMs) for handling bursts of events (coalesce by entity type), (5) deliverWebhookNotifications(events) emitting events to registered webhooks post-indexing. Create apps/api/migrations/105_add_event_streams.sql with: connector_event_streams (connector_id, enabled, event_types: 'entity_created'|'entity_updated'|'entity_deleted'|'relationship_changed', config_json), event_delivery_queue (event_id, status: 'pending'|'delivered'|'failed', retry_count, next_retry_at), event_audit_log (timestamp, connector_id, entity_id, change_type, change_summary, delivered_at, latency_ms). Integrate with webhook-driven sync: webhooks now trigger EventDrivenSyncEngine instead of full connector sync. Expose REST: GET /api/v1/connectors/:id/event-config (stream settings), PUT /api/v1/connectors/:id/event-config (enable/configure), GET /api/v1/events/audit (cursor-paginated event history with latency metrics), POST /api/v1/events/:id/retry (manual retry failed event). Build dashboard: apps/dashboard/components/event-stream-monitor.tsx (real-time event ingestion rate, latency percentiles p50/p95/p99, event type breakdown). Add 16+ unit tests for: event publication, subscription lifecycle, change processing, batch coalescing, webhook delivery, error handling with retry. Integration test: configure 3 connectors with event streaming, emit 1000 randomized change events over 10 seconds, verify all indexed within 2s, cache invalidation cascades correctly, audit log complete. Reference connector-patterns.md for webhook patterns, code-style.md for async/error handling.
- **Files**:
  - packages/semantic-core/src/event-driven-sync-engine.ts
  - packages/semantic-core/src/__tests__/event-driven-sync-engine.test.ts
  - packages/semantic-core/src/__tests__/event-driven-sync-engine.integration.test.ts
  - apps/api/src/routes/event-streams.ts
  - apps/api/src/__tests__/event-streams.test.ts
  - apps/api/migrations/105_add_event_streams.sql
  - apps/dashboard/components/event-stream-monitor.tsx
- **Depends on**: Webhook Management & Testing Dashboard (completed), CDC support in connectors
- **Added**: 2026-06-08

### Task: Multi-LLM Agent Context Learning & Feedback Loop
- **Layer**: 58 — Growth Phase II - Real-Time & Agent Learning
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a closed-loop system where agents that use Iris context provide feedback on result quality, which is automatically incorporated into relevance ranking, cache policies, and entity recommendations. Create packages/semantic-core/src/agent-feedback-engine.ts with AgentFeedbackEngine: (1) recordAgentUsage(agentId, query, contextServed, agentResponse, metadata) logging what context was served to an agent and what it responded with, (2) recordUserFeedback(usageId, rating, comments, correctedContext) capturing explicit feedback (1-5 star rating, optional comment, corrected context if agent was wrong), (3) inferFeedback(usageId) detecting implicit positive/negative feedback: same agent re-querying same question = negative feedback on previous context; agent quoting served context in final response = positive feedback, (4) updateRelevanceWeights(entityType, rating) adjusting semantic relevance scores for entity types based on aggregated feedback, (5) suggestContextExpansion(agentId, query) detecting common missing context patterns per agent. Create apps/api/migrations/106_add_agent_feedback.sql with: agent_context_usage (agent_id, query_hash, context_ids, context_budget_used, served_at), agent_feedback (usage_id, rating: 1-5, comment, corrected_context_json, created_at, feedback_source: 'explicit'|'implicit'|'inferred'), relevance_adjustments (entity_type_id, positive_feedback_count, negative_feedback_count, weight_adjustment, last_updated_at). Integrate with query-context MCP tool: include feedback_key in response so agents can score their use; periodically call updateRelevanceWeights. Expose REST: POST /api/v1/agents/:id/feedback (submit usage rating), GET /api/v1/agents/:id/insights (aggregated feedback, most/least useful context types), GET /api/v1/entities/:id/feedback-score (entity quality score from agent feedback). Build dashboard: apps/dashboard/components/agent-feedback-dashboard.tsx (feedback timeline per agent, top useful/unhelpful entities, suggested context adjustments). Add 14+ unit tests for: usage logging, feedback recording, weight adjustment calculations, expansion suggestion, implicit feedback detection. Integration test: simulate 10 agents querying with context over 100 interactions, provide mixed feedback, verify relevance weights update correctly, new queries show improved ranking. Reference query-learning-engine.ts for pattern extraction.
- **Files**:
  - packages/semantic-core/src/agent-feedback-engine.ts
  - packages/semantic-core/src/__tests__/agent-feedback-engine.test.ts
  - packages/semantic-core/src/__tests__/agent-feedback-engine.integration.test.ts
  - apps/api/src/routes/agent-feedback.ts
  - apps/api/src/__tests__/agent-feedback.test.ts
  - apps/api/migrations/106_add_agent_feedback.sql
  - apps/dashboard/components/agent-feedback-dashboard.tsx
- **Depends on**: Query Learning Engine (completed), Semantic Query Learning (completed)
- **Added**: 2026-06-08

### Task: Smart Schema Field Mapping & Connector Auto-Configuration
- **Layer**: 58 — Growth Phase II - Real-Time & Agent Learning
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an intelligent field mapping system that learns connector field transformations from user behavior and suggests automatic entity attribute mappings during connector setup, reducing manual configuration. Create packages/semantic-core/src/smart-field-mapper.ts with SmartFieldMapper: (1) learnFieldMappings(connectorId, userMappings) analyzing confirmed field mappings (email_address → email, account_name → label) to identify patterns, (2) suggestEntityMapping(connectorSchema, targetEntityType) proposing likely attribute assignments with confidence scores via semantic matching and learned patterns, (3) detectCommonTransformations(sourceField, targetField) recognizing standard patterns (snake_case to camelCase, ISO dates to unix timestamps, concat two fields), (4) validateMappingLogic(mapping) ensuring mappings won't produce data loss (e.g., many-to-one mappings lose information), (5) generateMappingCode(mapping) outputting TypeScript transformation functions for use in connectors. Create apps/api/migrations/107_add_field_mappings.sql with: learned_mappings (source_connector_id, source_field_name, target_field_name, target_entity_type, mapping_count, user_confirmed_count, confidence_score), mapping_transformations (id, transformation_type: 'direct'|'aggregate'|'compute'|'lookup', source_fields, target_field, logic_expression, created_by_user_id). Integrate with connector setup flow: when user creates new connector instance, SmartFieldMapper suggests mappings based on schema introspection + learned patterns. Expose REST: POST /api/v1/connectors/:id/suggest-mapping (run mapping suggestion), GET /api/v1/connectors/:id/mapping-suggestions (get all suggestions with confidence), POST /api/v1/connectors/:id/mapping-suggestions/:suggestionId/confirm (accept and apply), POST /api/v1/mapping-analytics (track mapping success). Build dashboard: apps/dashboard/components/field-mapping-assistant.tsx (show suggested mappings, drag-drop confirmation, transformation preview). Add 12+ unit tests for: pattern learning, semantic field matching, transformation validation, code generation, confidence scoring. Integration test: load 5 different connector types with 200 total fields, learn mappings from 50 confirmed decisions, suggest new mappings for similar fields, achieve ≥85% accuracy vs. manual mappings. Reference code-style.md for code generation best practices.
- **Files**:
  - packages/semantic-core/src/smart-field-mapper.ts
  - packages/semantic-core/src/__tests__/smart-field-mapper.test.ts
  - packages/semantic-core/src/__tests__/smart-field-mapper.integration.test.ts
  - apps/api/src/routes/field-mappings.ts
  - apps/api/src/__tests__/field-mappings.test.ts
  - apps/api/migrations/107_add_field_mappings.sql
  - apps/dashboard/components/field-mapping-assistant.tsx
- **Depends on**: Schema auto-discovery (completed), Connector framework (completed)
- **Added**: 2026-06-08

### Task: Context Delta Streaming & Incremental MCP Responses
- **Layer**: 58 — Growth Phase II - Real-Time & Agent Learning
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a system that tracks context state per MCP client and streams only what changed since the last query, reducing token consumption for agents that maintain state across multiple turns. Create packages/semantic-core/src/context-delta-streamer.ts with ContextDeltaStreamer: (1) captureContextSnapshot(clientId, query, context) hashing the context served to a client, (2) computeContextDelta(clientId, newContext, previousSnapshot) returning {added: Entity[], removed: Entity[], modified: {entity, changes: Delta[]}}, (3) streamDeltaAsChunks(delta, chunkSizeTokens) breaking deltas into token-bounded chunks for streaming, (4) encodeContextDelta(delta) optimizing delta encoding (references vs. full objects), (5) trackClientState(clientId, snapshot) maintaining client state across sessions with expiration. Create apps/api/migrations/108_add_context_deltas.sql with: mcp_client_context_state (client_id, workspace_id, last_query_hash, last_context_snapshot, entities_served, snapshot_created_at, expires_at), context_delta_audit (client_id, delta_id, entities_added_count, entities_removed_count, entities_modified_count, saved_tokens, stream_chunks, delivered_at). Integrate with MCP server query-context tool: check if client has prior context, compute delta, return {delta_mode: true, added, removed, modified} vs. full context. Expose REST: GET /api/v1/mcp-clients/:clientId/state (current context snapshot), GET /api/v1/mcp-clients/:clientId/context-history (cursor-paginated deltas), DELETE /api/v1/mcp-clients/:clientId/state (reset state, force full refresh). Build dashboard: apps/dashboard/components/context-delta-analyzer.tsx (show delta efficiency: tokens saved by deltas vs. full context, delta delivery timeline). Add 13+ unit tests for: delta computation accuracy, chunk encoding, client state tracking, token savings calculation, edge cases (null transitions, large deltas). Integration test: simulate agent with 20 sequential queries over 10 minutes, compute deltas for each, verify token savings ≥60% vs. full refresh, client state consistency. Reference compression pipeline.ts for serialization patterns.
- **Files**:
  - packages/semantic-core/src/context-delta-streamer.ts
  - packages/semantic-core/src/__tests__/context-delta-streamer.test.ts
  - packages/semantic-core/src/__tests__/context-delta-streamer.integration.test.ts
  - apps/api/src/routes/context-deltas.ts
  - apps/api/src/__tests__/context-deltas.test.ts
  - apps/api/migrations/108_add_context_deltas.sql
  - apps/dashboard/components/context-delta-analyzer.tsx
- **Depends on**: Semantic Cache (completed), Context Compression Pipeline (completed)
- **Added**: 2026-06-08

---

## Layer 59: Quality Assurance & Test Coverage Closure

### Task: Complete Test Suite for Untested API Routes
- **Layer**: 59 — Quality Assurance & Test Coverage Closure
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Write comprehensive test suites for 17 API routes that currently lack unit tests. These routes handle critical flows: audit-logs, query-analytics, schema-migrations, sso-config, entities, queries, and others. For each route, create test files that validate: (1) happy-path request validation and response format, (2) validation error handling (400), (3) auth errors (401/403), (4) not-found cases (404), (5) database/service failures (500). Use Vitest + Hono test utilities. Target 80%+ coverage per route file. Reference api-conventions.md for response envelope patterns.
- **Files**:
  - apps/api/src/__tests__/audit.test.ts
  - apps/api/src/__tests__/entities.test.ts
  - apps/api/src/__tests__/queries.test.ts
  - apps/api/src/__tests__/audit-logs.test.ts
  - apps/api/src/__tests__/cache-stats.test.ts
  - apps/api/src/__tests__/data-quality.test.ts
  - apps/api/src/__tests__/query-analytics.test.ts
  - apps/api/src/__tests__/schema-migrations.test.ts
  - apps/api/src/__tests__/sso-config.test.ts
  - apps/api/src/__tests__/api-key-management.test.ts
  - apps/api/src/__tests__/admin-cost-audit.test.ts
  - apps/api/src/__tests__/admin-dedup.test.ts
  - apps/api/src/__tests__/dsr.test.ts
  - apps/api/src/__tests__/enrichment-config.test.ts
  - apps/api/src/__tests__/index-optimization.test.ts
  - apps/api/src/__tests__/pii-config.test.ts
  - apps/api/src/__tests__/suggestions.test.ts
  - apps/api/src/__tests__/workspace-costs.test.ts
- **Depends on**: API Server Bootstrap (completed)
- **Added**: 2026-06-08

### Task: MCP Server Tool Integration Test Suite
- **Layer**: 59 — Quality Assurance & Test Coverage Closure
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build an end-to-end integration test suite for the MCP server's 13 tools that exercises real tool interactions and validates correctness. Create apps/mcp-server/src/__tests__/tools.integration.test.ts with tests for: (1) query-context with semantic cache hits/misses, (2) list-entities with pagination and filtering, (3) get-entity by ID with relationship expansion, (4) aggregation tools (sum, count, average) over entity sets, (5) comparison tools (entity diffs, schema changes), (6) anomaly detection over time-series metrics, (7) advanced-query-context with complex filter expressions, (8) streaming-context with token-bounded chunks, (9) federated-context queries across workspace boundaries. Each test should: mock the vector store and cache with realistic data, invoke the tool via the MCP server, validate response format matches tool schema, check token usage stays under budget, verify permission filtering is applied. Target 70%+ coverage of tool logic paths. Use Vitest with Mock Service Worker for API mocking.
- **Files**:
  - apps/mcp-server/src/__tests__/tools.integration.test.ts
  - apps/mcp-server/src/__tests__/fixtures/mock-entities.json
  - apps/mcp-server/src/__tests__/fixtures/mock-metrics.json
  - apps/mcp-server/src/__tests__/fixtures/mock-relationships.json
- **Depends on**: MCP Server Bootstrap (completed), Query Decomposition (completed)
- **Added**: 2026-06-08

### Task: Dashboard E2E Test Coverage for Admin & Settings Pages
- **Layer**: 59 — Quality Assurance & Test Coverage Closure
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the existing Playwright E2E test suite to cover the dashboard's 25+ admin and settings pages that manage critical system configuration. Create tests/e2e/dashboard-admin-pages.spec.ts covering: (1) admin console (view system status, start/stop sync jobs, inspect logs), (2) connector settings (add/remove connectors, configure OAuth, test connectivity), (3) role-based access control (create/modify/delete roles, assign permissions), (4) workspace config (edit name, billing info, retention policy), (5) API key management (generate/rotate/revoke keys), (6) SSO/SCIM setup (configure provider, test sync), (7) data export/import (trigger backup, restore from snapshot), (8) cost analytics (view spending trends, set budget alerts), (9) PII configuration (mask/redact sensitive fields, validate). Each test should: login as appropriate admin user, navigate to page, perform action, validate success message and database state, logout. Use test fixtures with preloaded workspace. Target 60+ test cases.
- **Files**:
  - tests/e2e/dashboard-admin-pages.spec.ts
  - tests/e2e/fixtures/admin-user.json
  - tests/e2e/fixtures/test-workspace-config.json
- **Depends on**: API Server Bootstrap (completed), Dashboard Bootstrap (completed)
- **Added**: 2026-06-08

### Task: Connector Health Monitoring Dashboard Enhancement
- **Layer**: 59 — Quality Assurance & Test Coverage Closure
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance the connector health monitoring system with real-time alerts, detailed failure diagnostics, and recovery suggestions. Create packages/semantic-core/src/connector-health-monitor.ts with ConnectorHealthMonitor: (1) trackSyncMetrics(connectorId, syncDuration, recordCount, errorCount, throttledRequests) continuously measuring connector performance, (2) detectUnhealthyState(connectorId) identifying when sync success rate drops below 95% or latency exceeds threshold, (3) suggestRecovery(connectorId, failureType) recommending actions (retry, rotate credentials, check rate limits, update schema), (4) emitHealthAlert(connectorId, severity, message) triggering dashboard notifications, (5) getHealthScore(connectorId) computing 0-100 score from sync success, latency, error patterns, throttling. Create apps/api/migrations/109_add_health_monitoring.sql with: connector_health_scores (connector_id, score, last_sync_success_rate, last_sync_latency_ms, last_checked_at), health_alerts (connector_id, severity: 'critical'|'warning'|'info', failure_type, suggested_action, acknowledged_at). Expose REST: GET /api/v1/connectors/:id/health (current score + alerts), POST /api/v1/connectors/:id/health/acknowledge (mark alert as seen). Build dashboard: apps/dashboard/components/connector-health-scorecard.tsx with health meter, recent alerts, suggested fixes. Add 14+ tests for metric tracking, health state detection, recovery suggestions.
- **Files**:
  - packages/semantic-core/src/connector-health-monitor.ts
  - packages/semantic-core/src/__tests__/connector-health-monitor.test.ts
  - apps/api/src/routes/connector-health.ts
  - apps/api/src/__tests__/connector-health.test.ts
  - apps/api/migrations/109_add_health_monitoring.sql
  - apps/dashboard/components/connector-health-scorecard.tsx
- **Depends on**: Connector framework (completed), Sync Scheduling (completed)
- **Added**: 2026-06-08

### Task: Query Cost Estimation & Optimization Recommendation Engine
- **Layer**: 59 — Quality Assurance & Test Coverage Closure
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an intelligent system that estimates LLM token costs for queries before execution and recommends optimizations to reduce cost. Create packages/semantic-core/src/query-cost-estimator.ts with QueryCostEstimator: (1) analyzeQueryStructure(query) extracting complexity features (entity types, filter depth, relationship traversals, requested context size), (2) estimateDeltaTokens(query, provider) predicting token consumption for query embedding + compression stages using historical regression model, (3) estimateContextTokens(entities, format) estimating tokens in final context delivery (different for JSON vs. prose), (4) rankOptimizations(query, context) suggesting 3-5 cost-reduction ideas: filter entities earlier, reduce relationship depth, increase cache TTL, use summarization, change serialization format, (5) predictCacheSavings(query) calculating likely token savings if result is cached. Create apps/api/migrations/110_add_query_cost_analysis.sql with: query_cost_estimates (query_hash, provider, estimated_delta_tokens, estimated_context_tokens, total_estimated_cost_cents, optimization_suggestions, created_at), cost_model_features (query_type: 'analytical'|'operational'|'reporting', entity_count_range, relationship_depth, model_accuracy_pct). Integrate: pass cost estimate + recommendations in query-context MCP response header. Expose REST: POST /api/v1/queries/estimate-cost (analyze hypothetical query), GET /api/v1/queries/cost-history (show actual vs. estimated for past queries). Build dashboard: apps/dashboard/components/query-cost-breakdown.tsx showing delta vs. context costs, optimization suggestions with impact estimates. Add 16+ tests for structure analysis, cost prediction accuracy, optimization ranking.
- **Files**:
  - packages/semantic-core/src/query-cost-estimator.ts
  - packages/semantic-core/src/__tests__/query-cost-estimator.test.ts
  - packages/semantic-core/src/__tests__/query-cost-estimator.integration.test.ts
  - apps/api/src/routes/query-cost-analysis.ts
  - apps/api/src/__tests__/query-cost-analysis.test.ts
  - apps/api/migrations/110_add_query_cost_analysis.sql
  - apps/dashboard/components/query-cost-breakdown.tsx
- **Depends on**: Query Optimizer (completed), Multi-LLM Cost Optimizer (completed)
- **Added**: 2026-06-08

## Layer 60: Advanced Quality & Observability Features

### Task: Semantic Deduplication Verification & Dashboard
- **Layer**: 60 — Advanced Quality & Observability Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a verification system and dashboard UI to inspect, analyze, and manage semantic deduplication results across indexed entities. Create packages/semantic-core/src/dedup-inspector.ts with DedupInspector: (1) analyzeDedupClusters(workspaceId, entityType) returning clusters of similar entities above 0.85 cosine similarity threshold with cluster members, similarity scores, and canonical entity designation, (2) compareEntities(entity1Id, entity2Id) showing side-by-side comparison of attributes, relationships, and source connectors, (3) suggestMerge(cluster) recommending which entity in cluster should be canonical based on data completeness and recency, (4) approveMerge(entity1Id, entity2Id, canonicalId) merging records and invalidating related caches, (5) explainDedupDecision(entity1Id, entity2Id) returning which attributes/embeddings drove similarity score. Create apps/api/migrations/111_add_dedup_analytics.sql with: dedup_clusters (workspace_id, cluster_id, entity_type, member_count, similarity_scores_json, canonical_entity_id, created_at, merged_at), dedup_decisions (workspace_id, source_entity_id, target_entity_id, confidence_score, attributes_compared_json, merge_status: 'pending'|'approved'|'rejected', reviewed_by_user_id). Expose REST: GET /api/v1/admin/dedup/clusters (list clusters), GET /api/v1/admin/dedup/clusters/:id/members (cluster members with scores), POST /api/v1/admin/dedup/merge (approve merge), GET /api/v1/entities/:id/dedup-status (show if entity is part of cluster). Build dashboard page at apps/dashboard/app/admin/dedup-analysis/page.tsx showing: cluster explorer (sortable by similarity score, member count), side-by-side entity comparison (attributes highlighted), merge approval workflow with undo history. Add 18+ tests for cluster analysis, deduplication decision logging, merge approval workflows, and cache invalidation.
- **Files**:
  - packages/semantic-core/src/dedup-inspector.ts
  - packages/semantic-core/src/__tests__/dedup-inspector.test.ts
  - packages/semantic-core/src/__tests__/dedup-inspector.integration.test.ts
  - apps/api/src/routes/dedup-admin.ts
  - apps/api/src/__tests__/dedup-admin.test.ts
  - apps/api/migrations/111_add_dedup_analytics.sql
  - apps/dashboard/app/admin/dedup-analysis/page.tsx
  - apps/dashboard/components/entity-comparison-panel.tsx
  - apps/dashboard/components/dedup-cluster-explorer.tsx
- **Depends on**: Semantic deduplication (completed), Entity Indexing (completed)
- **Added**: 2026-06-09

### Task: Context Budget Real-Time Monitoring & Alerting System
- **Layer**: 60 — Advanced Quality & Observability Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a real-time monitoring system that tracks context budget consumption across queries and surfaces alerts when approaching or exceeding configured budgets. Create packages/semantic-core/src/budget-monitor.ts with BudgetMonitor: (1) trackQueryBudget(query, contextSize, tokens, provider) logging each query's token consumption against workspace budget, (2) computeBudgetUtilization(workspaceId, timeWindow) returning total tokens used vs. configured budget as percentage, (3) detectBudgetAnomalies(workspaceId) using Z-score analysis to flag abnormal query patterns (sudden spike in avg context size, unusual entity type distribution), (4) suggestBudgetAdjustments(workspaceId) recommending new budget levels based on 7-day average + 20% headroom, (5) emitBudgetAlert(workspaceId, severity, trigger) triggering email/Slack/in-app notifications at 75%, 90%, 100% utilization. Create apps/api/migrations/112_add_budget_monitoring.sql with: workspace_budgets (workspace_id, monthly_token_budget, rolling_window_days, alert_thresholds: [75, 90, 100], auto_limit_mode: true|false), budget_usage_events (workspace_id, query_id, tokens_consumed, context_size, provider, timestamp), budget_alerts (workspace_id, threshold_pct, triggered_at, acknowledged_at, notification_channels_used). Integrate: intercept query-context MCP calls to track budget consumption, enforce hard limit if auto_limit_mode is enabled (truncate context if approaching limit). Expose REST: GET /api/v1/workspace/budget-status (current usage + trends), PUT /api/v1/workspace/budget-config (update limits + alert thresholds), GET /api/v1/workspace/budget-history (time-series chart data). Build dashboard widgets: apps/dashboard/components/budget-status-gauge.tsx (circular gauge showing utilization %), budget-usage-timeline.tsx (7-day rolling chart), budget-alerts-panel.tsx (active alerts with acknowledgement). Add 20+ tests for budget tracking, anomaly detection, alert triggers, and limit enforcement.
- **Files**:
  - packages/semantic-core/src/budget-monitor.ts
  - packages/semantic-core/src/__tests__/budget-monitor.test.ts
  - packages/semantic-core/src/__tests__/budget-monitor.integration.test.ts
  - apps/api/src/routes/budget-management.ts
  - apps/api/src/__tests__/budget-management.test.ts
  - apps/api/migrations/112_add_budget_monitoring.sql
  - apps/dashboard/components/budget-status-gauge.tsx
  - apps/dashboard/components/budget-usage-timeline.tsx
  - apps/dashboard/components/budget-alerts-panel.tsx
- **Depends on**: Query Cost Estimation (completed), MCP Server (completed)
- **Added**: 2026-06-09

### Task: Comprehensive Connector Integration Test Suite (V1 Connectors)
- **Layer**: 60 — Advanced Quality & Observability Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Write comprehensive MSW-based integration test suites for the five V1 connectors (Jira, Confluence, Linear, NetSuite, QuickBooks) that currently lack test coverage. For each connector, create a test file (e.g., packages/connectors/jira/src/__tests__/jira-connector.test.ts) that validates: (1) connect() with valid OAuth credentials (mock 200) and invalid credentials (mock 401), (2) getSchema() returns correct entity types and fields for the connector, (3) sync() pagination using API cursor to fetch all pages, (4) sync() relationship extraction (e.g., Jira issue → linked PRs), (5) sync() error handling on rate limits (429) with retry behavior, (6) healthCheck() returns healthy status on successful API call and degraded on timeout. Use MSW to mock all HTTP requests with realistic API response fixtures from each vendor's docs. Each test suite should include: 12–16 test cases, ≥80% code coverage of connector methods, fixtures in tests/fixtures/<connector>/ for different entity types and edge cases (empty results, missing fields, pagination). Reference connector-patterns.md for entity transformation and testing.md for test structure. Add fixture generation script to help create realistic mock responses. Goals: all V1 connectors reach 80%+ coverage, all tests pass in CI with MSW setup.
- **Files**:
  - packages/connectors/jira/src/__tests__/jira-connector.test.ts
  - packages/connectors/confluence/src/__tests__/confluence-connector.test.ts
  - packages/connectors/linear/src/__tests__/linear-connector.test.ts
  - packages/connectors/netsuite/src/__tests__/netsuite-connector.test.ts
  - packages/connectors/quickbooks/src/__tests__/quickbooks-connector.test.ts
  - tests/fixtures/jira/
  - tests/fixtures/confluence/
  - tests/fixtures/linear/
  - tests/fixtures/netsuite/
  - tests/fixtures/quickbooks/
- **Depends on**: Jira Connector (completed), Confluence Connector (completed), Linear Connector (completed), NetSuite Connector (completed), QuickBooks Connector (completed)
- **Added**: 2026-06-09

### Task: MCP Resources Implementation for Documents & Entities
- **Layer**: 60 — Advanced Quality & Observability Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the MCP server to expose indexed documents and entities as MCP resources (in addition to the existing tools), allowing Claude and other AI tools to read context directly via resource URIs without tool invocation. Implement apps/mcp-server/src/resources/ with resource handlers: (1) EntityResource (entity:///:workspaceId/:entityType/:entityId → returns full entity JSON with attributes, relationships, metadata), (2) DocumentResource (document:///:workspaceId/:docId → returns document content with pagination support for large files), (3) RelationshipGraphResource (graph:///:workspaceId/:entityId?depth=N → returns entity + N-hop related entities as JSON graph), (4) GlossaryResource (glossary:///:workspaceId → returns business glossary terms + definitions). Update apps/mcp-server/src/server.ts to register resources via MCP ResourceListResponse and ResourceReadResponse handlers. Implement permission checks (respects role-based context permissions). Support resource discovery: GET /api/v1/mcp/resources endpoint listing available resource types and sample URIs. Build dashboard documentation page at apps/dashboard/app/mcp/resources/page.tsx showing: available resource types, example URIs, how to use in Claude/ChatGPT prompts, rate limits per resource. Add 16+ tests for resource schemas, permission enforcement, pagination of large documents, and error handling. Reference MCP spec for resource format and api-conventions.md for REST discovery patterns.
- **Files**:
  - apps/mcp-server/src/resources/entity-resource.ts
  - apps/mcp-server/src/resources/document-resource.ts
  - apps/mcp-server/src/resources/graph-resource.ts
  - apps/mcp-server/src/resources/glossary-resource.ts
  - apps/mcp-server/src/__tests__/resources.test.ts
  - apps/api/src/routes/mcp-resource-discovery.ts
  - apps/api/src/__tests__/mcp-resource-discovery.test.ts
  - apps/dashboard/app/mcp/resources/page.tsx
- **Depends on**: MCP Server Bootstrap (completed), Role-Based Context Segmentation (completed)
- **Added**: 2026-06-09

### Task: Query Explanation Engine & Context Relevance Debugging
- **Layer**: 60 — Advanced Quality & Observability Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an explanation engine that helps users understand why specific entities and context chunks are retrieved for a given query, enabling debugging of unexpectedly poor or irrelevant context. Create packages/semantic-core/src/query-explainer.ts with QueryExplainer: (1) explainRetrieval(query, results) analyzing which entities were retrieved and scoring the relevance reasoning (semantic similarity score, relationship path depth, entity recency, type match), (2) breakdownScoring(entity, query) showing the contribution of each scoring factor (vector similarity to query embedding, entity freshness bonus, relationship expansion bonus), (3) suggestContextExpansion(query, currentResults) identifying related entities not retrieved that might improve context quality, (4) detectRetrievalAnomaly(query, results) flagging unexpected patterns (only one entity type returned when query is multi-domain, very low similarity scores despite match). Expose POST /api/v1/queries/:id/explain endpoint returning detailed JSON with: retrieved entities (with per-entity breakdown), scoring component breakdown, alternative retrieval paths considered, anomaly flags. Build dashboard component at apps/dashboard/components/query-explanation-panel.tsx showing: (1) retrieved entities list with expandable relevance breakdown, (2) scoring component chart (vector similarity, freshness, relationships), (3) entity relationship visualization showing why related entities were/weren't included, (4) suggestions for context improvement. Integrate into query editor: when user runs a test query, show explanation sidebar automatically. Add 14+ tests for explanation generation, scoring breakdown accuracy, anomaly detection with synthetic query/result datasets.
- **Files**:
  - packages/semantic-core/src/query-explainer.ts
  - packages/semantic-core/src/__tests__/query-explainer.test.ts
  - apps/api/src/routes/query-explanation.ts
  - apps/api/src/__tests__/query-explanation.test.ts
  - apps/dashboard/components/query-explanation-panel.tsx
  - apps/dashboard/components/scoring-breakdown-chart.tsx
- **Depends on**: Retrieval Engine (completed), Context Compression (completed)
- **Added**: 2026-06-09

---

## Layer 61: Production Maturity & Missing Core Features

### Task: Native Document Indexing from Connector Sources
- **Layer**: 61 — Production Maturity & Missing Core Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement native support for indexing unstructured documents from connectors (Google Drive PDFs, Notion pages, Confluence docs, Slack message threads) as searchable context entities. Create packages/semantic-core/src/document-indexer.ts with DocumentIndexer: (1) extractDocumentContent(source, sourceId) handling multiple formats (PDF text extraction via pdf-parse, HTML/Markdown parsing, binary office formats via LibreOffice), (2) chunkDocument(content, maxChunkTokens) splitting large documents into semantic chunks (sentence/paragraph boundaries, not mid-word), (3) indexDocumentChunks(workspace, chunks) storing chunks as document entities with metadata (source, page number, chunk index, extract_time). Create document_entities table (workspace_id, document_id, source_connector_id, source_document_id, title, content_hash, chunk_index, content_text, extracted_at) with FTS index on content_text. Extend connectors (Google Drive, Notion, Confluence) to export document content alongside structured data during sync. Add POST /api/v1/documents/import/bulk endpoint for batch document upload. Integrate retrieval engine to search documents alongside entities. Add 18+ tests for content extraction (various formats), chunking strategy, FTS search accuracy. Reference embedding-patterns.md for what to embed and semantic-core indexer patterns for batch processing.
- **Files**:
  - packages/semantic-core/src/document-indexer.ts
  - packages/semantic-core/src/__tests__/document-indexer.test.ts
  - packages/semantic-core/src/__tests__/document-indexer.integration.test.ts
  - apps/api/migrations/113_add_document_entities.sql
  - apps/api/src/routes/documents.ts
  - apps/api/src/__tests__/documents.test.ts
  - packages/connectors/google-drive/src/document-handler.ts (update)
  - packages/connectors/notion/src/document-handler.ts (update)
  - packages/connectors/confluence/src/document-handler.ts (update)
- **Depends on**: Indexer Implementation, Google Drive Connector, Notion Connector, Confluence Connector
- **Added**: 2026-06-09

### Task: Search Relevance Tuning & Ranking Improvements
- **Layer**: 61 — Production Maturity & Missing Core Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement configurable search relevance tuning and advanced ranking to improve query result quality across diverse entity types and query patterns. Create packages/semantic-core/src/relevance-tuner.ts with RelevanceTuner: (1) extractRankingFactors(query, entity) computing: vector similarity score, entity type match penalty (boost/penalize based on query intent), entity recency bonus (newer entities ranked higher), relationship proximity score (entities closer to query entity in graph ranked higher), field match score (entity attributes matching query terms), domain-specific weights (user can boost certain entity types). (2) tuneWeights(workspaceId, feedbackData) using supervised learning: collect user feedback (liked/disliked results), adjust weights to improve future ranking via gradient descent or Bayesian optimization. (3) rankEntities(entities, query, weights) applying weighted combination of factors. Store tuning state in relevance_tuning_models table (workspace_id, iteration, weights_json, feedback_count, auc_score, created_at). Expose admin API: GET /api/v1/admin/relevance/weights (current weights), POST /api/v1/admin/relevance/feedback (log user feedback), GET /api/v1/admin/relevance/metrics (ranking quality metrics: MRR, NDCG). Build admin tuning UI at apps/dashboard/components/relevance-tuner-panel.tsx showing: weight sliders per factor, feedback/quality chart over time, A/B test results (control vs. tuned weights). Add 20+ unit tests for factor extraction, weight application, feedback incorporation. Add integration tests with synthetic query/feedback datasets to validate learning. Reference embedding-patterns.md for similarity threshold guidance.
- **Files**:
  - packages/semantic-core/src/relevance-tuner.ts
  - packages/semantic-core/src/__tests__/relevance-tuner.test.ts
  - packages/semantic-core/src/__tests__/relevance-tuner.integration.test.ts
  - apps/api/migrations/114_add_relevance_tuning.sql
  - apps/api/src/routes/relevance.ts
  - apps/api/src/__tests__/relevance.test.ts
  - apps/dashboard/components/relevance-tuner-panel.tsx
- **Depends on**: Retrieval Engine, Query Decomposition & Entity Type Detection
- **Added**: 2026-06-09

### Task: Streaming Context for Large Result Sets
- **Layer**: 61 — Production Maturity & Missing Core Features
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement streaming context delivery for MCP tools to support large result sets without hitting token budget limits or causing timeout. Extend apps/mcp-server/src/tools/query-context.ts and list-entities.ts to support streaming mode: client provides optional ?stream=true query param, server returns Server-Sent Events (SSE) stream instead of JSON array. Create packages/semantic-core/src/streaming-context.ts with StreamingContextServer: (1) streamEntities(query, workspace, chunkSize) yielding entities in token-bounded chunks, (2) generateStreamChunk(entities, maxTokens) converting entity batch to compact JSON (use compression pipeline), (3) encodeChunkMetadata(chunkIndex, moreChunks, totalCount) including pagination info. Update MCP tool schema: add "stream" boolean input parameter. Integrate into query-context and list-entities tools: if stream=true, return SSE stream instead of single response. Add HTTP streaming endpoint POST /api/v1/mcp/stream/{toolName} accepting tool input and returning SSE stream. Build dashboard test page at apps/dashboard/app/mcp/stream-tester/page.tsx to test streaming queries (show chunk arrival timeline, total time, token estimate). Add 12+ tests for streaming logic, chunk boundaries, token counting accuracy, connection handling. Reference compression/pipeline.ts for serialization patterns and embedding-patterns.md for token budgeting.
- **Files**:
  - packages/semantic-core/src/streaming-context.ts
  - packages/semantic-core/src/__tests__/streaming-context.test.ts
  - apps/mcp-server/src/tools/query-context.ts (update)
  - apps/mcp-server/src/tools/list-entities.ts (update)
  - apps/api/src/routes/mcp-streaming.ts
  - apps/dashboard/app/mcp/stream-tester/page.tsx
  - apps/mcp-server/src/__tests__/server.integration.test.ts (update)
- **Depends on**: MCP Server Bootstrap, Compression Pipeline
- **Added**: 2026-06-09

### Task: Batch Entity Operations & Bulk Import/Export
- **Layer**: 61 — Production Maturity & Missing Core Features
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement efficient batch operations for entity management, including bulk import from CSV/JSON files and bulk export with filtering. Create packages/semantic-core/src/batch-operations.ts with BatchOperations: (1) parseImportFile(file, format: 'csv'|'json'|'parquet') validating schema and returning parsed records, (2) validateBatch(records, schema) checking required fields and data types, (3) importBatch(workspaceId, records) bulk inserting into vector store with deduplication, (4) exportBatch(workspaceId, filters, format) querying entities and serializing to requested format with streaming for large exports. Add POST /api/v1/entities/import endpoint accepting multipart form with CSV/JSON file, returning import job ID and status, with async processing via BullMQ queue. Add GET /api/v1/entities/export?format=csv&filter=type:contact endpoint returning streamed response. Create import_jobs table (workspace_id, job_id, file_name, record_count, imported_count, error_count, status, created_at). Build dashboard import/export wizard at apps/dashboard/app/entities/import-export/page.tsx with file uploader, schema mapper, preview before import, and export filter builder. Add 16+ tests for file parsing, schema validation, bulk operations, error recovery. Reference connector-patterns.md for entity transformation and testing.md for file fixture patterns.
- **Files**:
  - packages/semantic-core/src/batch-operations.ts
  - packages/semantic-core/src/__tests__/batch-operations.test.ts
  - packages/semantic-core/src/__tests__/batch-operations.integration.test.ts
  - apps/api/migrations/115_add_import_jobs.sql
  - apps/api/src/routes/bulk-operations.ts
  - apps/api/src/__tests__/bulk-operations.test.ts
  - apps/dashboard/app/entities/import-export/page.tsx
  - apps/dashboard/components/import-wizard.tsx
  - apps/dashboard/components/export-builder.tsx
- **Depends on**: Indexer Implementation, Connector Instance Management API
- **Added**: 2026-06-09

---

## Layer 62: Advanced Features & Polish

### Task: Natural Language Workspace Configuration Engine
- **Layer**: 62 — Advanced Features & Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a natural language configuration system that accepts business rules in plain English (e.g., "our fiscal year starts in February", "ARR is MRR * 12", "a deal is qualified if amount > $50K"). Use OpenAI GPT-4o to parse intent and auto-generate configuration code for glossary terms, metrics, and entity attributes. Store parsed configurations in migration 119 (nl_config_statements, nl_config_results). Provide REST POST /api/v1/workspace/nlp-config/parse-statement, GET /api/v1/workspace/nlp-config/statements. Add dashboard page /settings/[workspaceId]/nlp-config with statement history and confidence scores. Include 28+ tests (16 unit parsing + 12 route + compliance checks).
- **Files**:
  - packages/semantic-core/src/nlp-config-parser.ts
  - packages/semantic-core/src/__tests__/nlp-config-parser.test.ts
  - apps/api/src/routes/nlp-config.ts
  - apps/api/src/__tests__/nlp-config.test.ts
  - apps/dashboard/app/settings/[workspaceId]/nlp-config/page.tsx
  - apps/api/migrations/119_nlp_config_statements.sql
- **Depends on**: None
- **Added**: 2026-06-08

### Task: Agent Workflow Template Registry & Pre-Configuration
- **Layer**: 62 — Advanced Features & Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a registry of AI agent workflow templates pre-configured with Iris MCP context. Each template specifies: agent role, required tools (query-context, list-entities, get-metric), suggested system prompt, context budget, entity type filters, and caching strategy. Store in migration 120 (workflow_templates, template_tool_config). Implement WorkflowTemplateService with create/list/clone/export methods. Provide REST endpoints GET /api/v1/workflows, POST /api/v1/workflows/:id/clone (personalizes template for workspace). Add marketplace page /workflows showing templates with preview and one-click apply. Support templates for: sales-insights-agent, ops-qa-agent, financial-analyst-agent, customer-success-agent. Include 32+ tests (20 unit + 12 route).
- **Files**:
  - packages/semantic-core/src/workflow-template-registry.ts
  - packages/semantic-core/src/__tests__/workflow-template-registry.test.ts
  - apps/api/src/routes/workflow-templates.ts
  - apps/api/src/__tests__/workflow-templates.test.ts
  - apps/dashboard/app/workflows/page.tsx
  - apps/dashboard/components/workflow-template-card.tsx
  - apps/api/migrations/120_workflow_templates.sql
- **Depends on**: None
- **Added**: 2026-06-08

### Task: OSI (Open Semantic Interchange) Standard Export & Import
- **Layer**: 62 — Advanced Features & Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement full OSI standard export/import for entity graphs, glossary terms, and metric definitions per the OSI 2.0 spec. Export should produce JSON-LD documents with @context URIs, semantic types, and relationship links compatible with other semantic layer tools. Implement OsiExportService (exportWorkspaceToOsi, importFromOsi) with validation against OSI schema. Add REST POST /api/v1/workspace/export/osi and POST /api/v1/workspace/import/osi. Update data-exporter.ts to include OSI as an export format option. Provide dashboard bulk export UI. Support round-trip lossless export/import. Include 24+ tests (16 unit + 8 integration).
- **Files**:
  - packages/semantic-core/src/osi-interchange.ts
  - packages/semantic-core/src/__tests__/osi-interchange.test.ts
  - apps/api/src/routes/osi-interchange.ts
  - apps/api/src/__tests__/osi-interchange.test.ts
  - apps/dashboard/components/osi-export-wizard.tsx
- **Depends on**: None
- **Added**: 2026-06-08

### Task: Industry Benchmarking & Cross-Company Insights (Anonymized, Opt-In)
- **Layer**: 62 — Advanced Features & Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Complete the benchmarking system (BenchmarkingService stub exists) with anonymized peer comparison. Implement: (1) metrics collection (entity count, query latency p95, token savings %, cache hit rate) from opt-in workspaces, (2) anonymization pipeline (hash workspace ID, remove names/emails, aggregate by industry+company-size), (3) percentile calculation (p25, p50, p75, p90 per cohort), (4) comparative API endpoint GET /api/v1/benchmarks/peer-comparison returning workspace metrics vs. peers with percentile ranks. Add dashboard page /analytics/[workspaceId]/benchmarks with charts showing percentile position, peer count, and opt-in toggle. Ensure GDPR/CCPA compliance via consent management. Include 36+ tests (22 unit + 14 integration covering aggregation logic + consent).
- **Files**:
  - packages/semantic-core/src/benchmarking-service.ts
  - packages/semantic-core/src/__tests__/benchmarking-service.test.ts
  - apps/api/src/routes/benchmarking.ts
  - apps/api/src/__tests__/benchmarking.test.ts
  - apps/dashboard/app/analytics/[workspaceId]/benchmarks/page.tsx
  - apps/dashboard/components/peer-comparison-chart.tsx
  - apps/api/migrations/121_benchmarking_metrics.sql
- **Depends on**: None
- **Added**: 2026-06-08

### Task: Fine-Grained PII Field Masking UI & Audit Dashboard
- **Layer**: 62 — Advanced Features & Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance the existing PII masking system (pii-masker.ts exists with redact/hash/tokenize strategies) with a comprehensive admin dashboard. Implement: (1) field-level masking strategy selector (redact, hash, tokenize, keep-last-4), (2) audit trail of PII access attempts (which user/agent accessed which PII field when), (3) bulk masking rules editor (apply mask to all email fields across connectors), (4) test mode showing before/after masked output. Create REST GET /api/v1/admin/pii-access-audit (cursor-paginated) and PUT /api/v1/admin/pii-fields/:workspaceId/:connectorId/:fieldName/mask-strategy. Add dashboard page /admin/pii-config with 3 tabs: field strategies, access audit log, bulk rule editor. Include 28+ tests (16 unit + 12 route + audit compliance).
- **Files**:
  - packages/semantic-core/src/pii-masking-audit.ts
  - packages/semantic-core/src/__tests__/pii-masking-audit.test.ts
  - apps/api/src/routes/pii-masking-audit.ts
  - apps/api/src/__tests__/pii-masking-audit.test.ts
  - apps/dashboard/app/admin/pii-config/page.tsx
  - apps/dashboard/components/pii-field-editor.tsx
  - apps/dashboard/components/pii-access-audit-table.tsx
  - apps/api/migrations/122_pii_access_audit.sql
- **Depends on**: None
- **Added**: 2026-06-08

---

## Layer 63: Hardening & Integration Completeness

### Task: Distributed Tracing & OpenTelemetry Integration
- **Layer**: 63 — Hardening & Integration Completeness
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement end-to-end distributed tracing across MCP server, REST API, and connector syncs using OpenTelemetry and Jaeger (self-hosted). Create packages/semantic-core/src/tracing.ts with TracingService: (1) initializeTracer() configuring OTLP exporter to Jaeger, (2) createSpan(operationName, attributes) for request-scoped tracing, (3) recordSpanEvent(name, attributes) for milestones, (4) spanContext() to propagate trace IDs via W3C TraceContext headers. Add instrumentation to: indexing pipelines (entity extraction, embedding, deduplication), connector syncs (API calls, pagination, error recovery), MCP tool invocations (query-context response time, token counting, cache checks), and API routes (request-to-response latency by endpoint). Create migration 123 (trace_spans table for async trace storage fallback). Add dashboard /analytics/[workspaceId]/traces page with timeline flame-graph, latency p50/p95/p99 by operation, and error rate heatmap. Include 32+ tests (18 unit tracing + 14 integration spanning multiple services). Reference CLAUDE.md logging guidelines and ensure no PII in span attributes.
- **Files**:
  - packages/semantic-core/src/tracing.ts
  - packages/semantic-core/src/__tests__/tracing.test.ts
  - packages/semantic-core/src/__tests__/tracing.integration.test.ts
  - apps/api/src/middleware/tracing-middleware.ts
  - apps/api/migrations/123_trace_spans.sql
  - apps/mcp-server/src/telemetry-middleware.ts
  - apps/dashboard/app/analytics/[workspaceId]/traces/page.tsx
  - apps/dashboard/components/trace-flame-graph.tsx
  - apps/dashboard/components/trace-latency-histogram.tsx
  - infra/docker/docker-compose.yml (add Jaeger service)
- **Depends on**: None
- **Added**: 2026-06-08

### Task: High-Availability Failover & Multi-Region Support
- **Layer**: 63 — Hardening & Integration Completeness
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement active-passive failover and optional multi-region read-replica support for production deployments. Create packages/semantic-core/src/ha-manager.ts with HaManager: (1) detectPrimaryFailure() via periodic health checks to primary Postgres + Redis + Qdrant with configurable timeout/retry, (2) initiateFailo ver() promoting read-replica to primary with DNS/routing update, (3) validateReplicationLag() ensuring replica lag < threshold before promotion, (4) syncSecondaryContextIndex() triggering incremental reindex on promoted region, (5) recordFailoverEvent(timestamp, reason, metrics) for audit. Add migration 124 (ha_failover_log, replication_status, region_config tables). Create REST POST /api/v1/admin/ha/failover (admin-only, requires confirmation), GET /api/v1/admin/ha/status returning primary/replica health + replication lag. Add health-check endpoint /health/ha returning { status, primary_region, replica_regions, lag_seconds }. Build dashboard admin page /admin/ha-config with region selector, replica lag graph, manual failover button + confirmation modal. Ensure read queries route to replica when available (via connection pool strategy). Include 28+ tests (16 unit failover logic + 12 integration multi-region scenarios). Reference api-conventions.md for error codes (503 if primary unavailable).
- **Files**:
  - packages/semantic-core/src/ha-manager.ts
  - packages/semantic-core/src/__tests__/ha-manager.test.ts
  - packages/semantic-core/src/__tests__/ha-manager.integration.test.ts
  - apps/api/src/routes/ha-admin.ts
  - apps/api/src/__tests__/ha-admin.test.ts
  - apps/api/migrations/124_ha_failover_config.sql
  - apps/dashboard/app/admin/ha-config/page.tsx
  - apps/dashboard/components/failover-control-panel.tsx
  - apps/dashboard/components/replication-lag-monitor.tsx
- **Depends on**: None
- **Added**: 2026-06-08

### Task: Connector Circuit Breaker & Graceful Degradation Strategy
- **Layer**: 63 — Hardening & Integration Completeness
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement Circuit Breaker pattern for all connector API calls to prevent cascading failures. Create packages/semantic-core/src/circuit-breaker.ts with CircuitBreakerService: (1) executeWithCircuitBreaker(connectorId, fn) wrapping all connector API calls, (2) recordAttempt(success, latencyMs, errorCode) updating state machine, (3) getConnectorStatus() returning CLOSED/OPEN/HALF_OPEN with fail_count/success_count/last_failure_at, (4) resetCircuit(connectorId) manually resetting after manual remediation. State transitions: CLOSED → OPEN on 5 consecutive failures or error_rate > 50% over rolling 1min window; OPEN → HALF_OPEN after 30s backoff; HALF_OPEN → CLOSED on 2 successes, else back to OPEN. When OPEN, return cached/fallback context instead of failing the query (graceful degradation). Create migration 125 (circuit_breaker_state, fallback_context table). Add REST GET /api/v1/admin/connectors/:id/circuit-status returning state + metrics, POST /api/v1/admin/connectors/:id/circuit-reset. Add dashboard widget on connector detail page showing circuit state (traffic-light indicator), failure count, auto-recovery countdown. Include 36+ tests (20 unit state machine + 16 integration covering all transition paths + fallback scenarios).
- **Files**:
  - packages/semantic-core/src/circuit-breaker.ts
  - packages/semantic-core/src/__tests__/circuit-breaker.test.ts
  - packages/semantic-core/src/__tests__/circuit-breaker.integration.test.ts
  - apps/api/src/routes/circuit-breaker-admin.ts
  - apps/api/src/__tests__/circuit-breaker-admin.test.ts
  - apps/api/migrations/125_circuit_breaker_state.sql
  - apps/dashboard/components/circuit-breaker-indicator.tsx
  - apps/dashboard/components/connector-resilience-widget.tsx
- **Depends on**: Connector Instance Management API
- **Added**: 2026-06-08

---

## Layer 64: Production Readiness & API Polish

### Task: API Versioning & Deprecation Management System
- **Layer**: 64 — Production Readiness & API Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive API versioning and deprecation tracking to support multiple API versions concurrently with smooth migration paths. Create packages/semantic-core/src/api-versioning.ts with ApiVersionManager: (1) defineEndpointVersion(path, version, status='active'|'deprecated'|'sunset'), (2) checkVersionSupport(version, minVersion) validating requested version against min/max, (3) parseApiVersionHeader() extracting X-API-Version header (default: v1), (4) validateVersionCompat(version, requiredFeatures) ensuring feature availability, (5) generateDeprecationWarning(oldPath, newPath, sunsetDate) for response headers. Create migration 128 (api_versions, endpoint_versions, deprecation_timeline). Add Hono middleware apps/api/src/middleware/api-version.ts that: injects version into request context, validates availability, adds `Deprecation: true` + `Sunset: <date>` + `API-Warn` headers to deprecated endpoints. Add REST GET /api/v1/admin/api-versions returning all versions with status + feature list, GET /api/v1/admin/endpoints/:version/deprecated returning deprecated endpoints with migration guide URLs. Add dashboard page /admin/api-versioning with version timeline, endpoint deprecation tracker, client adoption metrics per version, and migration playbook per deprecated endpoint. Include 28+ tests (16 unit versioning logic + 12 route coverage for deprecation warnings).
- **Files**:
  - packages/semantic-core/src/api-versioning.ts
  - packages/semantic-core/src/__tests__/api-versioning.test.ts
  - apps/api/src/middleware/api-version.ts
  - apps/api/src/routes/api-version-admin.ts
  - apps/api/src/__tests__/api-version-admin.test.ts
  - apps/api/migrations/128_api_versions.sql
  - apps/dashboard/app/admin/api-versioning/page.tsx
  - apps/dashboard/components/version-timeline.tsx
  - apps/dashboard/components/deprecation-tracker.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Content Negotiation & Response Format Support (JSON/CSV/Parquet)
- **Layer**: 64 — Production Readiness & API Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement HTTP content negotiation to serve context and entity data in multiple formats (JSON, CSV, Parquet) based on Accept headers, enabling downstream BI tools and data warehouses to consume Iris data efficiently. Create packages/semantic-core/src/response-serializer.ts with ResponseSerializer: (1) parseAcceptHeader(header) extracting preferred format + quality, (2) serializeAsJson(entities) standard JSON envelope, (3) serializeAsCsv(entities, schema) flat CSV with proper quoting/escaping, (4) serializeAsParquet(entities, schema) columnar Parquet with gzip compression for data warehouse compatibility, (5) selectFormat(acceptHeader, available=[json, csv, parquet]) choosing best match. Add Hono middleware apps/api/src/middleware/content-negotiation.ts that: intercepts response, checks Accept header, calls appropriate serializer, sets Content-Type + Content-Disposition headers. Extend entity/query/metric endpoints to support ?format=json|csv|parquet query param as override. Create migration 129 (response_format_audit) to track format usage. Add dashboard analytics widget showing format distribution by endpoint and client type. Include 32+ tests (18 serialization format accuracy + 14 middleware content-type validation).
- **Files**:
  - packages/semantic-core/src/response-serializer.ts
  - packages/semantic-core/src/__tests__/response-serializer.test.ts
  - apps/api/src/middleware/content-negotiation.ts
  - apps/api/src/__tests__/content-negotiation.test.ts
  - apps/api/migrations/129_response_format_audit.sql
  - apps/dashboard/components/response-format-analytics.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Webhook Delivery Reliability & Dead-Letter Queue Management
- **Layer**: 64 — Production Readiness & API Polish
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Enhance webhook delivery reliability with exponential backoff retries, dead-letter queue (DLQ) management, and inspection/replay capabilities. Create packages/semantic-core/src/webhook-reliability.ts with WebhookReliabilityManager: (1) enqueueWebhookWithRetry(event, endpoint, retryPolicy) queuing via BullMQ with exponential backoff (1s, 4s, 16s, 64s, 256s), (2) markWebhookFailed(webhookId, finalError) moving to DLQ after max retries exhausted, (3) inspectDlqEvent(eventId) returning full payload + error trace + retry history, (4) replayDlqEvent(eventId, patchPayload?) retrying a dead-lettered event with optional payload modification, (5) analyzeDlqPatterns() identifying systemic issues (bad endpoint URL, network issues, payload schema mismatch). Create migration 130 (webhook_retry_log, webhook_dlq, dlq_analysis). Add REST routes: GET /api/v1/admin/webhooks/dlq (cursor-paginated DLQ events with error classification), POST /api/v1/admin/webhooks/dlq/:id/retry (manual replay with optional patch), POST /api/v1/admin/webhooks/dlq/analyze (returns pattern analysis + remediation suggestions). Add dashboard page /admin/webhooks/dlq with table of failed deliveries, retry history graph, error breakdown pie chart, pattern alerts. Add automatic DLQ cleanup (events older than 30 days). Include 34+ tests (20 unit retry logic + 14 integration DLQ + replay scenarios).
- **Files**:
  - packages/semantic-core/src/webhook-reliability.ts
  - packages/semantic-core/src/__tests__/webhook-reliability.test.ts
  - packages/semantic-core/src/__tests__/webhook-reliability.integration.test.ts
  - apps/api/src/routes/webhook-dlq-admin.ts
  - apps/api/src/__tests__/webhook-dlq-admin.test.ts
  - apps/api/migrations/130_webhook_dlq_management.sql
  - apps/dashboard/app/admin/webhooks/dlq/page.tsx
  - apps/dashboard/components/dlq-event-table.tsx
  - apps/dashboard/components/dlq-pattern-analysis.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Connector Performance Optimization Dashboard & Auto-Tuning
- **Layer**: 64 — Production Readiness & API Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a comprehensive connector performance dashboard with observability for throughput, latency, and resource utilization, plus an auto-tuning engine that recommends and applies optimizations. Create packages/connector-sdk/src/performance-optimizer.ts with ConnectorPerformanceOptimizer: (1) analyzeConnectorMetrics(connectorId, window) computing throughput (records/sec), latency (API call p50/p95/p99), error rate, batch efficiency, (2) identifyPaginationPattern(connectorId) detecting cursor vs offset vs keyset pagination, (3) adaptiveBatchSize(currentBatchSize, errorRate, latency) recommending optimal batch size (50-500 range), (4) computeOptimalConcurrency(connectorId, throughput, errorRate) suggesting concurrency level (1-10), (5) suggestRateLimitAdjustment(apiLimitExceeded, currentDelay) recommending request delay, (6) predictConnectorCapacity(metrics, scalingFactor) estimating max sustainable throughput. Create migration 131 (connector_performance_metrics) storing batch/concurrency/rateLimit recommendations. Add REST routes: GET /api/v1/connectors/:id/performance-stats (throughput chart, latency p-tile distribution, error rate timeline), GET /api/v1/connectors/:id/optimization-recs (array of { recommendation, expectedBenefit, risk }), POST /api/v1/connectors/:id/apply-optimization (apply a recommended optimization). Add dashboard page /connectors/:id/performance with: throughput sparkline, latency heatmap, batch/concurrency gauges, optimization panel with before/after comparison. Include 30+ tests (18 unit optimizer logic + 12 route integration with perf data).
- **Files**:
  - packages/connector-sdk/src/performance-optimizer.ts
  - packages/connector-sdk/src/__tests__/performance-optimizer.test.ts
  - apps/api/src/routes/connector-performance.ts
  - apps/api/src/__tests__/connector-performance.test.ts
  - apps/api/migrations/131_connector_perf_metrics.sql
  - apps/dashboard/app/connectors/[id]/performance/page.tsx
  - apps/dashboard/components/throughput-chart.tsx
  - apps/dashboard/components/latency-distribution.tsx
  - apps/dashboard/components/optimization-recommender.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: MCP Tool Coverage Expansion & Discovery
- **Layer**: 64 — Production Readiness & API Polish
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Expand MCP tool coverage with additional utility tools for common AI agent patterns (bulk operations, temporal queries, multi-entity analysis) and implement a tool discovery endpoint that dynamically advertises available tools based on workspace configuration. Create apps/mcp-server/src/tools/bulk-entity-update.ts (update multiple entities by filter), apps/mcp-server/src/tools/entity-trend-analysis.ts (analyze metric trends over time windows), apps/mcp-server/src/tools/entity-dependency-graph.ts (discover all entities dependent on a given entity). Add MCP resource discovery endpoint POST /api/v1/mcp/tools/discover returning schema + usage examples for all registered tools filtered by workspace context (respects role-based tool filtering). Create apps/api/src/routes/mcp-tool-discovery.ts with: GET /api/v1/mcp/tools (all available tools with schemas), GET /api/v1/mcp/tools/:name/usage-stats (tool invocation count, avg latency, error rate), GET /api/v1/mcp/tools/:name/examples (curated usage examples per tool). Add dashboard page /mcp-tools with searchable tool catalog, tool schemas with field descriptions, usage examples, popularity metrics. Include 26+ tests (14 new tool logic + 12 discovery endpoint coverage).
- **Files**:
  - apps/mcp-server/src/tools/bulk-entity-update.ts
  - apps/mcp-server/src/tools/entity-trend-analysis.ts
  - apps/mcp-server/src/tools/entity-dependency-graph.ts
  - apps/api/src/routes/mcp-tool-discovery.ts
  - apps/api/src/__tests__/mcp-tool-discovery.test.ts
  - apps/dashboard/app/mcp-tools/page.tsx
  - apps/dashboard/components/tool-schema-viewer.tsx
  - apps/dashboard/components/tool-usage-stats.tsx
  - apps/dashboard/components/tool-examples-panel.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Service-Level Objective (SLO) Monitoring & Alerting Engine
- **Layer**: 63 — Hardening & Integration Completeness
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement SLO tracking for key operational metrics with automated alerting when thresholds are breached. Create packages/semantic-core/src/slo-monitor.ts with SloService: (1) defineSlo(name, metric, target, window, severity) registering SLOs for: MCP query latency p95 < 2s (99%), API availability (99.9%), connector sync success rate > 95%, index staleness < 6h (95%), (2) calculateSloAttainment(metric, window) computing percentage of time SLO was met using event log, (3) detectSloViolation() comparing attainment against target with grace period (e.g., 5min before alerting), (4) suggestCorrectiveAction() using rule engine (increase cache TTL, upgrade vector-store, throttle indexing, etc.). Create migration 126 (slo_definitions, slo_events, slo_violations, slo_alerts). Add REST GET /api/v1/admin/slos returning all SLOs with current attainment%, GET /api/v1/admin/slos/:name/violations (historical). Add dashboard page /admin/slos with SLO cards (green if >= target, yellow if 95-99%, red if < 95%), trend sparkline, violation timeline, alert history. Integrate with existing AlertingService for alert delivery (email, Slack, PagerDuty via webhook). Include 34+ tests (20 unit SLO math + 14 integration covering violation detection + corrective actions).
- **Files**:
  - packages/semantic-core/src/slo-monitor.ts
  - packages/semantic-core/src/__tests__/slo-monitor.test.ts
  - packages/semantic-core/src/__tests__/slo-monitor.integration.test.ts
  - apps/api/src/routes/slo-admin.ts
  - apps/api/src/__tests__/slo-admin.test.ts
  - apps/api/migrations/126_slo_monitoring.sql
  - apps/dashboard/app/admin/slos/page.tsx
  - apps/dashboard/components/slo-scorecard.tsx
  - apps/dashboard/components/slo-trend-chart.tsx
  - apps/dashboard/components/slo-violation-timeline.tsx
- **Depends on**: Connector Health Monitoring Dashboard Enhancement
- **Added**: 2026-06-08

### Task: Intelligent Backup & Point-in-Time Recovery with RTO/RPO Guarantees
- **Layer**: 63 — Hardening & Integration Completeness
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Enhance the existing backup system (IndexSnapshotService exists) with incremental backups, continuous transaction logs, and point-in-time recovery (PITR) capability with defined RTO/RPO SLAs. Create packages/semantic-core/src/backup-manager.ts with BackupService: (1) createFullBackup(timestamp) capturing entity graph + vector embeddings + metrics as gzip (baseline), (2) createIncrementalBackup(since_timestamp) capturing only changed entities via transaction log, (3) restoreToPoint(target_timestamp) performing PITR from full backup + replay incremental logs, (4) calculateBackupSize(), (5) pruneOldBackups(retention_days), (6) validateBackupIntegrity() via checksum verification. Create migration 127 (backup_manifests, transaction_log, backup_integrity_checks). Add REST POST /api/v1/admin/backups/full, POST /api/v1/admin/backups/incremental, POST /api/v1/admin/backups/:id/restore-to-point?timestamp=..., GET /api/v1/admin/backups (cursor-paginated with size/status/duration). Add dashboard /admin/backup-recovery page with: backup calendar heatmap, restore wizard (select timestamp → preview entities → confirm), RTO/RPO metrics (last_backup_age, recovery_time_estimate, data_loss_estimate). Add automated daily full backup + hourly incremental backups via BullMQ. Include 32+ tests (18 unit backup logic + 14 integration covering PITR accuracy + integrity checks).
- **Files**:
  - packages/semantic-core/src/backup-manager.ts
  - packages/semantic-core/src/__tests__/backup-manager.test.ts
  - packages/semantic-core/src/__tests__/backup-manager.integration.test.ts
  - apps/api/src/routes/backup-recovery.ts
  - apps/api/src/__tests__/backup-recovery.test.ts
  - apps/api/migrations/127_backup_rto_rpo.sql
  - apps/dashboard/app/admin/backup-recovery/page.tsx
  - apps/dashboard/components/backup-calendar.tsx
  - apps/dashboard/components/point-in-time-restore-wizard.tsx
  - apps/dashboard/components/rto-rpo-metrics.tsx
- **Depends on**: Index Snapshot Export & Disaster Recovery
- **Added**: 2026-06-08

---

## Layer 65: Security, Observability & Developer Experience

### Task: Advanced User & Role Management with Granular Permissions
- **Layer**: 65 — Security, Observability & Developer Experience
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive user and role management system with fine-grained permission controls beyond the existing RBAC. Create packages/semantic-core/src/permission-manager.ts with PermissionManager: (1) definePermission(name, resource, action, conditions?) registering granular permissions (e.g., "read:entities:customer", "write:queries:own", "admin:connectors:salesforce"), (2) assignPermissionToRole(roleId, permission, contextFilter?) assigning permissions with optional context filters (e.g., can read entities from specific connectors only), (3) evaluateUserPermission(userId, permission, context) checking if user has permission with context enforcement, (4) bulkAdjustRolePermissions() for batch permission grants/revokes. Create migration 131 (permissions, role_permissions, permission_audit) with audit trail for all permission changes. Add REST routes: GET /api/v1/admin/roles/:id/permissions (list effective permissions), PUT /api/v1/admin/roles/:id/permissions/:permission/grant, DELETE /api/v1/admin/roles/:id/permissions/:permission/revoke, POST /api/v1/admin/roles/:id/permissions/audit (audit trail with actor/timestamp/change). Add dashboard /admin/permissions page with: role-permission matrix, permission inheritance visualization, bulk permission editor, audit log viewer. Include role templates (Viewer, Analyst, Admin) with preset permissions. Include 28+ tests (16 unit permission evaluation + 12 route permission management + audit compliance).
- **Files**:
  - packages/semantic-core/src/permission-manager.ts
  - packages/semantic-core/src/__tests__/permission-manager.test.ts
  - apps/api/src/routes/permission-management.ts
  - apps/api/src/__tests__/permission-management.test.ts
  - apps/api/migrations/131_granular_permissions.sql
  - apps/dashboard/app/admin/permissions/page.tsx
  - apps/dashboard/components/role-permission-matrix.tsx
  - apps/dashboard/components/permission-inheritance-tree.tsx
  - apps/dashboard/components/bulk-permission-editor.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Rate Limiting & Quota Management System
- **Layer**: 65 — Security, Observability & Developer Experience
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement multi-level rate limiting and quota enforcement (per-user, per-API-key, per-workspace, per-connector) with fair-share algorithms and quota override capabilities for burst scenarios. Create packages/semantic-core/src/rate-limiter.ts with RateLimitManager: (1) configureLimit(identifier, type, limit, window) defining limits (e.g., "10 requests/second per API key", "1M tokens/day per workspace"), (2) checkLimit(identifier, cost?) evaluating if request is within quota and returning remaining allowance, (3) recordUsage(identifier, cost, metadata) incrementing usage counter, (4) requestQuotaIncrease(workspaceId, reason) tracking quota increase requests with approval workflow, (5) computeFairShare(identifiers, totalBudget) allocating budget proportionally when multiple users contend for shared resources. Store limits in Redis with Lua-script atomic increments. Create migration 132 (rate_limits, usage_tracking, quota_overrides, quota_requests). Add Hono middleware apps/api/src/middleware/rate-limiting.ts enforcing limits transparently. Add REST routes: GET /api/v1/usage (current usage + remaining quota), POST /api/v1/quota-increase-request (submit increase request with justification), GET /api/v1/admin/rate-limits (view all configured limits), PUT /api/v1/admin/rate-limits/:id (modify limit), POST /api/v1/admin/quota-overrides (grant temporary override). Add dashboard widgets: usage meter (per endpoint category), quota tracker, pending increase requests, rate limit breach alerts. Include 32+ tests (18 unit rate limiter + quota logic + 14 integration Redis-backed + middleware behavior).
- **Files**:
  - packages/semantic-core/src/rate-limiter.ts
  - packages/semantic-core/src/__tests__/rate-limiter.test.ts
  - packages/semantic-core/src/__tests__/rate-limiter.integration.test.ts
  - apps/api/src/middleware/rate-limiting.ts
  - apps/api/src/routes/quota-management.ts
  - apps/api/src/__tests__/quota-management.test.ts
  - apps/api/migrations/132_rate_limits_quota.sql
  - apps/dashboard/components/usage-meter.tsx
  - apps/dashboard/components/quota-tracker.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: CLI Tool Suite for Iris Administration & Connector Management
- **Layer**: 65 — Security, Observability & Developer Experience
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a production-ready CLI tool suite (scripts/iris-cli.ts + build as executable) for operators and developers to manage Iris instances from the command line. Implement: (1) connector commands (list, describe, sync, test, health-check), (2) index commands (reindex-connector, analyze-index, rebuild-glossary, deduplicate-entities), (3) workspace commands (create, delete, list-members, export-context), (4) backup commands (create-full-backup, restore-point-in-time, list-backups, verify-integrity), (5) diagnostics commands (check-services, profile-slow-queries, analyze-token-usage, validate-config), (6) admin commands (enable-feature, set-quota, reset-rate-limit, audit-export). All commands should support --workspace, --output (json/table/csv), --dry-run flags and require API key auth via IRIS_API_KEY env var. Use CLI framework (e.g., oclif or Ink for TUI). Create comprehensive help system with examples for each command. Include interactive mode for exploratory queries. Document in docs/cli-guide.md. Include 24+ tests (14 command parsing + 10 integration against mock API).
- **Files**:
  - scripts/iris-cli.ts
  - scripts/__tests__/iris-cli.test.ts
  - scripts/__tests__/iris-cli.integration.test.ts
  - scripts/bin/iris (executable wrapper)
  - docs/cli-guide.md
  - packages/semantic-core/src/cli-client.ts
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Advanced Metrics & Analytics Pipeline for Operational Insights
- **Layer**: 65 — Security, Observability & Developer Experience
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an advanced analytics pipeline aggregating query latency, token efficiency gains, connector health trends, and cost breakdowns, with retention and rollup policies for long-term insights. Create packages/semantic-core/src/analytics-engine.ts with AnalyticsService: (1) recordMetricEvent(name, value, dimensions, timestamp) capturing events (query_latency, tokens_saved, connector_error, cache_hit), (2) aggregateMetrics(metricName, window, dimensions) computing p50/p95/p99/mean/stddev by time window and dimension (by connector, by workspace, by user), (3) detectAnomalies() via exponential smoothing + z-score detection, (4) rollupOldData() downsampling hourly → daily → monthly on retention schedule. Create migration 133 (metric_events, metric_aggregates_hourly/daily/monthly) with time-based partitioning. Add REST routes: GET /api/v1/analytics/metrics/:name?window=1h|1d|1w&dimensions=connector,user (time-series aggregates + anomalies), GET /api/v1/analytics/dashboards/:templateName returning pre-computed views (token-efficiency, connector-health, user-adoption, cost-trends). Add dashboard /analytics/[workspaceId]/overview page with: metric cards (avg token_saved%, total queries, top connectors by usage), anomaly timeline, cost breakdown by connector/entity-type, user adoption trend. Include 30+ tests (18 unit aggregation + 12 integration partitioned data + anomaly detection).
- **Files**:
  - packages/semantic-core/src/analytics-engine.ts
  - packages/semantic-core/src/__tests__/analytics-engine.test.ts
  - packages/semantic-core/src/__tests__/analytics-engine.integration.test.ts
  - apps/api/src/routes/analytics-pipeline.ts
  - apps/api/src/__tests__/analytics-pipeline.test.ts
  - apps/api/migrations/133_metric_events_analytics.sql
  - apps/dashboard/app/analytics/[workspaceId]/overview/page.tsx
  - apps/dashboard/components/metric-overview-cards.tsx
  - apps/dashboard/components/anomaly-timeline.tsx
  - apps/dashboard/components/cost-breakdown-chart.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

---

## Layer 66: Advanced Semantic Features & Intelligent Governance

### Task: Entity Lifecycle Management & Temporal Metadata Tracking
- **Layer**: 66 — Advanced Semantic Features & Intelligent Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement comprehensive entity lifecycle management with temporal tracking of status changes, ownership, approval workflows, and deprecation handling. Create packages/semantic-core/src/entity-lifecycle.ts with EntityLifecycleManager: (1) defineEntityStatus(entityId, status, reason, metadata) registering status transitions (DRAFT/PUBLISHED/DEPRECATED/ARCHIVED), (2) trackStatusHistory(entityId, window) returning full timeline with actor/timestamp/reason, (3) approveEntity(entityId, approverId, conditions?) with optional conditional approvals (e.g., "requires 2 approvals if PII"), (4) deprecateEntity(entityId, replacementId, sunsetDate) marking for retirement with successor mapping, (5) queryEntitiesByLifecycle(filters) retrieving entities by status with stale/at-risk flags, (6) computeEntityHealthScore(entityId) based on recency, approval status, accuracy signal. Create migration 134 (entity_lifecycle_states, lifecycle_events, entity_approvals) with lifecycle history partitioning. Add REST routes: GET /api/v1/entities/:id/lifecycle (status + timeline + approvals), PUT /api/v1/entities/:id/lifecycle/status (status change with audit), GET /api/v1/admin/lifecycle-dashboard (deprecated entity warnings, approval queue, deprecation roadmap). Add dashboard page /admin/entity-lifecycle with: status breakdown pie chart, timeline flow diagram for single entities, bulk status editor for mass transitions, approval queue with SLA tracking. Include 32+ tests (18 unit lifecycle state machine + 14 integration approval workflows + temporal queries).
- **Files**:
  - packages/semantic-core/src/entity-lifecycle.ts
  - packages/semantic-core/src/__tests__/entity-lifecycle.test.ts
  - packages/semantic-core/src/__tests__/entity-lifecycle.integration.test.ts
  - apps/api/src/routes/entity-lifecycle.ts
  - apps/api/src/__tests__/entity-lifecycle.test.ts
  - apps/api/migrations/134_entity_lifecycle.sql
  - apps/dashboard/app/admin/entity-lifecycle/page.tsx
  - apps/dashboard/components/lifecycle-status-bar.tsx
  - apps/dashboard/components/lifecycle-timeline.tsx
  - apps/dashboard/components/entity-approval-queue.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Intelligent Query Template Library & Auto-Generation
- **Layer**: 66 — Advanced Semantic Features & Intelligent Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a query template library system that allows teams to save, share, and discover reusable query patterns with AI-assisted generation. Create packages/semantic-core/src/query-templates.ts with QueryTemplateManager: (1) createTemplate(name, query, parameters, description, tags, visibility) saving parameterized queries with metadata, (2) generateFromNaturalLanguage(description, entityTypes) using LLM to generate query template from English description, (3) suggestTemplatesForQuery(query) finding similar saved templates via embedding, (4) instantiateTemplate(templateId, parameterValues) binding parameters to template, (5) trackTemplateUsage(templateId) recording usage metrics (frequency, avg_latency, cache_hit_rate), (6) suggestOptimizations(templateId) analyzing usage patterns to recommend query rewrites. Create migration 135 (query_templates, template_parameters, template_usage, template_suggestions). Add REST routes: GET /api/v1/templates (cursor-paginated with search/filter/sort), POST /api/v1/templates (create/share), PUT /api/v1/templates/:id (update), POST /api/v1/templates/:id/instantiate (bind + execute), GET /api/v1/templates/:id/analytics (usage stats + optimization recs). Add dashboard page /templates with: template gallery (filterable, searchable), template creator wizard (natural language input or visual builder), usage analytics per template, suggestion panel for optimization. Include 28+ tests (16 unit template logic + LLM fallback + 12 route template management + instantiation).
- **Files**:
  - packages/semantic-core/src/query-templates.ts
  - packages/semantic-core/src/__tests__/query-templates.test.ts
  - packages/semantic-core/src/__tests__/query-templates.integration.test.ts
  - apps/api/src/routes/query-templates.ts
  - apps/api/src/__tests__/query-templates.test.ts
  - apps/api/migrations/135_query_templates.sql
  - apps/dashboard/app/templates/page.tsx
  - apps/dashboard/components/template-gallery.tsx
  - apps/dashboard/components/template-creator.tsx
  - apps/dashboard/components/template-usage-analytics.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Connector Marketplace & Plugin Distribution Framework
- **Layer**: 66 — Advanced Semantic Features & Intelligent Governance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create a connector marketplace system enabling community connectors, vendor-verified connectors, and private plugin distribution with dependency resolution and version management. Create packages/semantic-core/src/connector-marketplace.ts with MarketplaceService: (1) publishConnector(manifest, package, version, releaseNotes) uploading connector to registry with signature verification, (2) searchConnectors(query, filters) querying marketplace by name/category/rating/author, (3) resolveConnectorDependencies(connectorId, version) computing transitive dependency tree with conflict detection, (4) installConnector(connectorId, version, workspace) installing verified connector with auto-updates, (5) rateConnector(connectorId, rating, review, verified_installation) tracking quality signals, (6) getConnectorTelemetry(connectorId) returning usage stats (installations, uninstalls, error rates by version). Create migration 136 (connector_registry, connector_versions, connector_dependencies, connector_ratings, marketplace_audit). Add REST routes: GET /api/v1/marketplace/connectors (search + pagination), GET /api/v1/marketplace/connectors/:id/versions (version history + changelogs), POST /api/v1/marketplace/connectors/:id/install, POST /api/v1/marketplace/connectors/:id/rate, GET /api/v1/marketplace/featured (community picks + trending). Add dashboard /marketplace page with: connector catalog (cards with ratings/downloads/version), detail page (compatibility matrix, dependency graph, installation instructions, reviews). Add background job for connector auto-updates (opt-in per workspace). Include 30+ tests (16 unit marketplace logic + dependency resolution + 14 integration registry + install workflows).
- **Files**:
  - packages/semantic-core/src/connector-marketplace.ts
  - packages/semantic-core/src/__tests__/connector-marketplace.test.ts
  - packages/semantic-core/src/__tests__/connector-marketplace.integration.test.ts
  - apps/api/src/routes/marketplace.ts
  - apps/api/src/__tests__/marketplace.test.ts
  - apps/api/migrations/136_connector_marketplace.sql
  - apps/dashboard/app/marketplace/page.tsx
  - apps/dashboard/app/marketplace/[connectorId]/page.tsx
  - apps/dashboard/components/connector-card.tsx
  - apps/dashboard/components/connector-detail-panel.tsx
  - apps/dashboard/components/dependency-graph-viewer.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Data Retention Policies & Automated Entity Archival
- **Layer**: 66 — Advanced Semantic Features & Intelligent Governance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement fine-grained data retention and archival policies with automated cleanup, audit trails, and recovery capabilities. Create packages/semantic-core/src/retention-manager.ts with RetentionPolicyService: (1) defineRetentionPolicy(entityType, retentionDays, archiveAction, conditions?) configuring retention by entity type with optional conditions (e.g., "keep indefinitely if belongs to top-100 accounts"), (2) computeArchivalDate(entity, policy) calculating when entity should be archived, (3) archiveEntity(entityId, reason, recoveryWindow) moving to cold storage with recovery window (default: 30 days), (4) restoreArchivedEntity(entityId) restoring from archive within recovery window, (5) runArchivalJobScheduled() batch archival process, (6) queryArchivedEntities(filters) searching archived entities by type/date/reason. Create migration 137 (retention_policies, archived_entities, archival_audit) with archival state tracking. Add REST routes: GET /api/v1/admin/retention-policies, PUT /api/v1/admin/retention-policies/:type (update policy), GET /api/v1/admin/archived-entities (paginated with filters), POST /api/v1/admin/archived-entities/:id/restore (restore within window). Add dashboard page /admin/retention with: policy matrix (entity type vs retention days), archived entity count by type/date, recovery window warnings, bulk restore interface. Include 28+ tests (16 unit archival logic + conditions + 12 integration scheduled jobs + recovery).
- **Files**:
  - packages/semantic-core/src/retention-manager.ts
  - packages/semantic-core/src/__tests__/retention-manager.test.ts
  - packages/semantic-core/src/__tests__/retention-manager.integration.test.ts
  - apps/api/src/routes/retention-policies.ts
  - apps/api/src/__tests__/retention-policies.test.ts
  - apps/api/migrations/137_retention_policies.sql
  - apps/dashboard/app/admin/retention/page.tsx
  - apps/dashboard/components/retention-policy-matrix.tsx
  - apps/dashboard/components/archived-entity-browser.tsx
  - apps/dashboard/components/recovery-window-warning.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Entity Relationship Recommendations & Auto-Linking Engine
- **Layer**: 66 — Advanced Semantic Features & Intelligent Governance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build an intelligent relationship recommendation engine that suggests missing entity links using semantic similarity, co-occurrence patterns, and domain knowledge. Create packages/semantic-core/src/relationship-recommender.ts with RelationshipRecommendationService: (1) suggestRelationships(entityId, topK=10) ranking potential relationship targets by confidence score (embedding similarity 40% + cooccurrence 30% + type compatibility 20% + domain rules 10%), (2) autoLinkEntities(fromId, toId, relationshipType, confidence) creating auto-links above confidence threshold (default: 0.75) with human-in-the-loop review, (3) denyRelationshipSuggestion(fromId, toId) recording negative feedback to avoid re-suggesting, (4) learnFromAcceptedRelationships() updating weighting model based on accepted vs rejected suggestions, (5) bulkSuggestRelationships(entityIds) batch recommendation for entity type reconciliation. Create migration 138 (relationship_suggestions, relationship_feedback, suggestion_metrics). Add REST routes: GET /api/v1/entities/:id/suggested-relationships (ranked suggestions with confidence + reasoning), POST /api/v1/entities/:id/relationships/auto-link (accept suggestions), POST /api/v1/entities/:id/relationship-feedback/:targetId (feedback signal). Add dashboard UI: suggestions widget on entity detail page (shows top 5 + "see all" modal), bulk linking interface for reconciliation, feedback history + model performance metrics. Include 30+ tests (18 unit scoring logic + ML model update + 12 route feedback handling).
- **Files**:
  - packages/semantic-core/src/relationship-recommender.ts
  - packages/semantic-core/src/__tests__/relationship-recommender.test.ts
  - packages/semantic-core/src/__tests__/relationship-recommender.integration.test.ts
  - apps/api/src/routes/relationship-recommendations.ts
  - apps/api/src/__tests__/relationship-recommendations.test.ts
  - apps/api/migrations/138_relationship_suggestions.sql
  - apps/dashboard/components/relationship-suggestions-widget.tsx
  - apps/dashboard/components/bulk-linking-interface.tsx
  - apps/dashboard/components/suggestion-feedback-chart.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

---

## Layer 67: Advanced Insights, Automation & Quality Assurance

### Task: Team & Role-Based Context Recommendation Engine
- **Layer**: 67 — Advanced Insights, Automation & Quality Assurance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build an intelligent context recommendation system that surfaces relevant data to entire teams and roles based on historical access patterns, job functions, and entity relationships. Create packages/semantic-core/src/team-context-recommender.ts with TeamContextRecommender: (1) analyzeTeamContextUsage(teamId, window) computing aggregate context usage patterns by role, (2) generateTeamRecommendations(teamId, topK=15) ranking entities by relevance to team (role-weighted access patterns 40% + entity recency 30% + relationship to accessed entities 20% + popularity in team 10%), (3) predictContextNeedsByRole(roleId) using historical queries to predict what contexts a role needs, (4) suggestContextExpansionForTeam(teamId) recommending underutilized but valuable entities. Create migration 139 (team_context_usage, role_context_affinities, team_recommendations, recommendation_feedback). Add REST routes: GET /api/v1/teams/:id/recommended-contexts (ranked by relevance + reasoning), PUT /api/v1/teams/:id/context-preferences (save overrides), GET /api/v1/roles/:id/context-predictions (role-specific predictions). Add dashboard page /team-insights with: recommended contexts widget per team, context popularity heatmap by role, "new contexts to explore" cards with onboarding, team context access timeline. Include 28+ tests (16 unit scoring + role analysis + 12 integration team patterns).
- **Files**:
  - packages/semantic-core/src/team-context-recommender.ts
  - packages/semantic-core/src/__tests__/team-context-recommender.test.ts
  - packages/semantic-core/src/__tests__/team-context-recommender.integration.test.ts
  - apps/api/src/routes/team-recommendations.ts
  - apps/api/src/__tests__/team-recommendations.test.ts
  - apps/api/migrations/139_team_context_recommendations.sql
  - apps/dashboard/app/team-insights/page.tsx
  - apps/dashboard/components/team-context-recommendations.tsx
  - apps/dashboard/components/role-context-heatmap.tsx
  - apps/dashboard/components/context-adoption-tracker.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Automated Business Insight Generation & Reporting
- **Layer**: 67 — Advanced Insights, Automation & Quality Assurance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Create an automated insight generation system that analyzes indexed data to surface actionable business intelligence without manual queries. Create packages/semantic-core/src/insight-generator.ts with InsightGenerator: (1) discoverInsights(entityTypes, filters) scanning entities to detect patterns (anomalies, outliers, trends, missing data, relationships), (2) generateInsightReport(entityType, granularity='daily'|'weekly') creating executive summaries with key metrics, trend direction, flagged exceptions, (3) scoreInsightValue(insight) ranking insights by business impact (frequency of affected entities, impact on metrics, novelty), (4) scheduleInsightGeneration(entityTypes, frequency, recipients) configuring automated daily/weekly reports with delivery, (5) explainInsight(insightId) providing drill-down details and data sources. Create migration 140 (generated_insights, insight_metrics, insight_delivery_jobs, insight_value_feedback). Add REST routes: GET /api/v1/insights (paginated, filterable by type/value), GET /api/v1/insights/:id/details (full insight with evidence), POST /api/v1/insights/:id/feedback (value signal), GET /api/v1/insights/scheduled (scheduled reports). Add dashboard page /insights with: insights feed (sortable by value, recency, impact), "did you know?" widgets on overview, scheduled report management, insight value feedback + trending topics. Include 32+ tests (18 unit insight discovery + scoring + 14 integration report generation).
- **Files**:
  - packages/semantic-core/src/insight-generator.ts
  - packages/semantic-core/src/__tests__/insight-generator.test.ts
  - packages/semantic-core/src/__tests__/insight-generator.integration.test.ts
  - apps/api/src/routes/insights.ts
  - apps/api/src/__tests__/insights.test.ts
  - apps/api/migrations/140_insights_generation.sql
  - apps/dashboard/app/insights/page.tsx
  - apps/dashboard/components/insights-feed.tsx
  - apps/dashboard/components/insight-detail-panel.tsx
  - apps/dashboard/components/insights-value-gauge.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Dynamic Business Rule Engine & Data Validation Framework
- **Layer**: 67 — Advanced Insights, Automation & Quality Assurance
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement a rule engine allowing teams to define and enforce business validation rules on entities with automated violation detection, correction suggestions, and audit trails. Create packages/semantic-core/src/business-rule-engine.ts with RuleEngine: (1) defineRule(name, entityType, condition, action, severity) creating rules like "contacts must have email OR phone" with violation severity levels, (2) evaluateEntity(entity) running all rules against entity and returning violations with correction suggestions, (3) bulkEvaluateRules(entities, ruleIds) batch processing with reporting, (4) suggestRuleCorrections(entityId, ruleId) recommending fixes based on similar valid entities, (5) autoCorrectViolations(entityIds, ruleIds, trustLevel) auto-fix low-risk violations (e.g., trim whitespace, standardize case), (6) trackRuleViolations(window) reporting violation trends and rule effectiveness. Create migration 141 (business_rules, rule_violations, rule_corrections, violation_stats). Add REST routes: GET/POST/PUT/DELETE /api/v1/admin/rules (CRUD), POST /api/v1/entities/:id/validate (validate against rules), GET /api/v1/admin/rule-violations (paginated violations with drill-down), POST /api/v1/admin/violations/:id/auto-fix (auto-correct). Add dashboard page /admin/data-rules with: rule builder (visual + JSON), violation dashboard (by rule/type/severity), rule effectiveness chart (% compliant over time), bulk auto-fix interface. Include 36+ tests (20 unit rule logic + condition evaluation + 16 integration violation detection + auto-correct).
- **Files**:
  - packages/semantic-core/src/business-rule-engine.ts
  - packages/semantic-core/src/__tests__/business-rule-engine.test.ts
  - packages/semantic-core/src/__tests__/business-rule-engine.integration.test.ts
  - apps/api/src/routes/business-rules.ts
  - apps/api/src/__tests__/business-rules.test.ts
  - apps/api/migrations/141_business_rules.sql
  - apps/dashboard/app/admin/data-rules/page.tsx
  - apps/dashboard/components/rule-builder.tsx
  - apps/dashboard/components/violations-dashboard.tsx
  - apps/dashboard/components/rule-effectiveness-chart.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Batch Context Recommendations & Multi-Entity Analysis API
- **Layer**: 67 — Advanced Insights, Automation & Quality Assurance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Extend the context recommendation system to support batch analysis of multiple entities, returning relevant contexts for each with deduplication and cross-entity insights. Create packages/semantic-core/src/batch-recommender.ts with BatchContextRecommender: (1) recommendContextForEntities(entityIds, topK=10) returning entity-specific recommendations and shared contexts across all, (2) analyzeEntityGroup(entityIds) finding common characteristics, gaps, and relationships among entities, (3) suggestGroupActions(entityIds) recommending bulk updates or linking based on group analysis, (4) computeGroupScore(entityIds, metric) aggregating metrics across entity group with variance/trend indicators. Create migration 142 (batch_analysis_cache, group_recommendations). Add REST routes: POST /api/v1/batch/recommend-contexts (body: entityIds, returns array of per-entity recommendations + group insights), POST /api/v1/batch/analyze (analyze group characteristics), GET /api/v1/batch/results/:sessionId (cache batch results). Add dashboard feature: multi-entity select mode with batch recommendation panel showing per-entity + group insights, suggested actions. Include 24+ tests (14 unit batch scoring + group analysis + 10 integration multi-entity patterns).
- **Files**:
  - packages/semantic-core/src/batch-recommender.ts
  - packages/semantic-core/src/__tests__/batch-recommender.test.ts
  - packages/semantic-core/src/__tests__/batch-recommender.integration.test.ts
  - apps/api/src/routes/batch-recommendations.ts
  - apps/api/src/__tests__/batch-recommendations.test.ts
  - apps/api/migrations/142_batch_recommendations.sql
  - apps/dashboard/components/batch-context-panel.tsx
  - apps/dashboard/components/group-analysis-results.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Semantic Search Quality Evaluation & Ranking Debugger
- **Layer**: 67 — Advanced Insights, Automation & Quality Assurance
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Build a search quality evaluation framework with explainable ranking, A/B testing capabilities, and automated quality metrics to help teams optimize their search relevance. Create packages/semantic-core/src/search-quality-evaluator.ts with SearchQualityEvaluator: (1) evaluateSearchResult(query, result) scoring result quality (relevance, freshness, completeness, rank position) with detailed breakdown, (2) runSearchTest(testName, queries, goldStandard, strategy1, strategy2) comparing ranking strategies with precision/recall/ndcg metrics, (3) explainRanking(query, resultId, topK=5) breaking down why result ranked where (term match, embedding sim, recency, popularity, user feedback), (4) suggestRankingImprovements(query) identifying low-performing queries and recommending fixes. Create migration 143 (search_quality_evals, ranking_tests, eval_results, quality_feedback). Add REST routes: POST /api/v1/search-quality/evaluate (single query evaluation), POST /api/v1/search-quality/tests (run ranking test), GET /api/v1/search-quality/tests/:id/results (test results + stats), GET /api/v1/search-quality/metrics (aggregate quality metrics). Add dashboard page /search-quality with: recent query evaluation timeline, A/B test runner (strategy picker, metric viewer), ranking explainer (show scoring breakdown for result position), suggested improvements panel. Include 28+ tests (16 unit evaluation scoring + 12 integration A/B testing).
- **Files**:
  - packages/semantic-core/src/search-quality-evaluator.ts
  - packages/semantic-core/src/__tests__/search-quality-evaluator.test.ts
  - packages/semantic-core/src/__tests__/search-quality-evaluator.integration.test.ts
  - apps/api/src/routes/search-quality.ts
  - apps/api/src/__tests__/search-quality.test.ts
  - apps/api/migrations/143_search_quality.sql
  - apps/dashboard/app/search-quality/page.tsx
  - apps/dashboard/components/ranking-explainer.tsx
  - apps/dashboard/components/ab-test-runner.tsx
  - apps/dashboard/components/quality-metrics-dashboard.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

---

## Layer 68: Advanced Retrieval, Analytics & Observability

### Task: Multi-Stage Query Expansion & Iterative Context Refinement
- **Layer**: 68 — Advanced Retrieval, Analytics & Observability
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Implement iterative query expansion that retrieves initial context, allows user feedback, and refines results in subsequent rounds. Create packages/semantic-core/src/query-expansion-engine.ts with QueryExpansionEngine: (1) expandQuery(query, stage=1, feedback=null) retrieving initial K results, then re-ranking based on feedback (stale, incomplete, irrelevant marks), (2) suggestExpansionDirections(query, results) identifying expansion axes (time range, entity types, attributes to explore), (3) computeExpansionRelevance(originalQuery, expansion) scoring how helpful an expansion dimension would be, (4) refineContextByFeedback(results, userFeedback) adjusting weights and retrieval strategy based on explicit user marks. Create migration 144 (query_expansion_sessions, expansion_feedback, expansion_suggestions). Add MCP tool: query-context-refined (takes original query + expansion params + feedback history, returns expanded results). Add REST routes: POST /api/v1/queries/:id/expand (execute expansion with optional direction), POST /api/v1/queries/:id/feedback (submit refinement feedback), GET /api/v1/expansion-sessions/:id (view expansion history). Add dashboard component: query-expansion-interface.tsx (show initial results, feedback buttons, suggested expansions, refined results). Include 26+ tests (15 unit expansion scoring + 11 integration multi-stage retrieval).
- **Files**:
  - packages/semantic-core/src/query-expansion-engine.ts
  - packages/semantic-core/src/__tests__/query-expansion-engine.test.ts
  - packages/semantic-core/src/__tests__/query-expansion-engine.integration.test.ts
  - apps/api/src/routes/query-expansion.ts
  - apps/api/src/__tests__/query-expansion.test.ts
  - apps/api/migrations/144_query_expansion.sql
  - apps/mcp-server/src/tools/query-context-refined.ts
  - apps/dashboard/components/query-expansion-interface.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Advanced Cost Attribution & Per-Entity Chargeback Model
- **Layer**: 68 — Advanced Retrieval, Analytics & Observability
- **Status**: COMMITTED
- **Priority**: High
- **Description**: Build a detailed cost attribution system that tracks token consumption, API calls, and compute costs at per-entity, per-connector, per-user, and per-query granularity. Create packages/semantic-core/src/cost-attribution.ts with CostAttributor: (1) attributeCostToEntity(queryId, entityId, tokensUsed, computeMs) recording entity-level cost contribution, (2) computeConnectorCost(connectorId, period) aggregating sync costs (API calls, bandwidth) + query retrieval costs per connector, (3) aggregateUserCosts(userId, period) summing all user queries + resulting infrastructure costs with per-connector breakdown, (4) computeCostForecast(entityId, interval) predicting entity retrieval costs based on access patterns. Create migration 145 (entity_cost_attribution, connector_cost_events, user_cost_ledger, cost_forecasts). Add REST routes: GET /api/v1/cost-attribution/entities/:id (entity cost breakdown by operation), GET /api/v1/cost-attribution/connectors/:id (connector cost summary), GET /api/v1/cost-attribution/users/:id (user cost ledger with daily/monthly aggregates), GET /api/v1/cost-attribution/forecasts (cost projections). Add dashboard page: cost-chargeback/page.tsx with: entity-centric cost heatmap, connector cost-per-record analysis, user cost allocation table, forecast trends. Include 24+ tests (14 unit cost aggregation + 10 integration forecast accuracy).
- **Files**:
  - packages/semantic-core/src/cost-attribution.ts
  - packages/semantic-core/src/__tests__/cost-attribution.test.ts
  - packages/semantic-core/src/__tests__/cost-attribution.integration.test.ts
  - apps/api/src/routes/cost-attribution.ts
  - apps/api/src/__tests__/cost-attribution.test.ts
  - apps/api/migrations/145_cost_attribution.sql
  - apps/dashboard/app/admin/cost-chargeback/page.tsx
  - apps/dashboard/components/entity-cost-heatmap.tsx
  - apps/dashboard/components/connector-cost-analysis.tsx
  - apps/dashboard/components/user-cost-ledger.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Multi-Connector Entity Matching & Reconciliation Engine
- **Layer**: 68 — Advanced Retrieval, Analytics & Observability
- **Status**: COMMITTED
- **Priority**: Medium
- **Description**: Implement cross-connector entity matching that identifies the same real-world entity appearing in different systems (e.g., same customer in HubSpot and Salesforce) and provides reconciliation workflows. Create packages/semantic-core/src/entity-reconciler.ts with EntityReconciler: (1) findMatchCandidates(entityId, topK=5) using embedding similarity + fuzzy name matching + attribute overlap to find candidates from other connectors, (2) scoreMatchConfidence(entity1, entity2) computing confidence 0–1 based on attribute overlap (email, phone, address), embedding distance, and relationship patterns, (3) suggestReconciliation(sourceId, targetIds) grouping candidates and recommending merge order, (4) recordReconciliationDecision(sourceId, targetId, decision) logging accepts/rejects for active learning. Create migration 146 (entity_matches, reconciliation_records, match_artifacts). Add REST routes: GET /api/v1/entities/:id/matches (find cross-connector matches), POST /api/v1/entities/reconcile (execute merge/link), GET /api/v1/reconciliation-status (view pending decisions). Add dashboard component: entity-reconciliation-panel.tsx (show candidate matches with confidence scores, side-by-side attribute comparison, accept/reject/manual-review buttons). Include 22+ tests (12 unit matching scoring + 10 integration cross-connector patterns).
- **Files**:
  - packages/semantic-core/src/entity-reconciler.ts
  - packages/semantic-core/src/__tests__/entity-reconciler.test.ts
  - packages/semantic-core/src/__tests__/entity-reconciler.integration.test.ts
  - apps/api/src/routes/entity-reconciliation.ts
  - apps/api/src/__tests__/entity-reconciliation.test.ts
  - apps/api/migrations/146_entity_reconciliation.sql
  - apps/dashboard/components/entity-reconciliation-panel.tsx
  - apps/dashboard/components/reconciliation-status-table.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Semantic Query Caching with Time-Based Versioning & Hit Analysis
- **Layer**: 68 — Advanced Retrieval, Analytics & Observability
- **Status**: IN_PROGRESS
- **Priority**: Medium
- **Description**: Extend semantic caching to include temporal query versioning, cache hit analysis, and predictive cache warming based on query access patterns. Create packages/semantic-core/src/temporal-query-cache.ts with TemporalQueryCache: (1) cacheQueryResult(query, result, asOfDate, ttl) storing time-versioned query results with point-in-time semantics, (2) queryAsOfDate(query, targetDate) retrieving cached results from a specific date without re-executing, (3) analyzeCacheHits(interval) computing hit rate, miss patterns, and frequently-missed query combinations, (4) warmCacheProactively(interval) identifying high-value queries to pre-cache based on access patterns. Create migration 147 (temporal_query_cache, cache_hit_analysis). Add REST routes: GET /api/v1/cache/temporal/:queryId/:date (fetch cached result), GET /api/v1/cache/analytics (hit rate, miss patterns), POST /api/v1/cache/preload (trigger proactive warming). Add dashboard components: cache-hit-timeline.tsx (visualize cache hits over time), miss-pattern-analyzer.tsx (show why queries miss cache). Include 20+ tests (12 unit cache logic + 8 integration temporal queries).
- **Files**:
  - packages/semantic-core/src/temporal-query-cache.ts
  - packages/semantic-core/src/__tests__/temporal-query-cache.test.ts
  - packages/semantic-core/src/__tests__/temporal-query-cache.integration.test.ts
  - apps/api/src/routes/temporal-cache.ts
  - apps/api/src/__tests__/temporal-cache.test.ts
  - apps/api/migrations/147_temporal_query_cache.sql
  - apps/dashboard/components/cache-hit-timeline.tsx
  - apps/dashboard/components/miss-pattern-analyzer.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

---

## Layer 69: Data Freshness, Sync Observability & Quality Orchestration

### Task: Data Freshness Tracking & Time-to-Update Analytics
- **Layer**: 69 — Data Freshness, Sync Observability & Quality Orchestration
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement comprehensive data freshness monitoring that tracks entity staleness, sync latency, and time-to-update metrics per entity type and connector. Create packages/semantic-core/src/freshness-tracker.ts with FreshnessTracker: (1) recordEntitySync(entityId, entityType, connectorId, lastModified) capturing entity modification timestamps at sync time, (2) computeFreshness(entityId) returning age (now - lastModified), percentile freshness across entity type, and staleness warnings if age exceeds SLA, (3) analyzeFreshnessMetrics(connectorId, interval) computing mean time-to-index, sync frequency compliance, freshness percentiles (p50/p95/p99), (4) predictNextStaleEvent(entityId, connectorId) estimating when entity will exceed freshness SLA based on modification patterns. Create migration 148 (entity_freshness_tracking, freshness_events, freshness_slas). Add REST routes: GET /api/v1/freshness/entities/:id (entity age + SLA status), GET /api/v1/freshness/metrics/:connectorId (freshness stats per connector), GET /api/v1/freshness/slas (workspace freshness SLA config + compliance). Add dashboard components: freshness-timeline.tsx (age timeline per entity type), staleness-alerts-panel.tsx (entities approaching SLA), freshness-compliance-heatmap.tsx (entity type × connector freshness matrix). Include 24+ tests (14 unit freshness computation + 10 integration SLA enforcement).
- **Files**:
  - packages/semantic-core/src/freshness-tracker.ts
  - packages/semantic-core/src/__tests__/freshness-tracker.test.ts
  - packages/semantic-core/src/__tests__/freshness-tracker.integration.test.ts
  - apps/api/src/routes/freshness-tracking.ts
  - apps/api/src/__tests__/freshness-tracking.test.ts
  - apps/api/migrations/148_freshness_tracking.sql
  - apps/dashboard/components/freshness-timeline.tsx
  - apps/dashboard/components/staleness-alerts-panel.tsx
  - apps/dashboard/components/freshness-compliance-heatmap.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Connector Reliability Scoring & Proactive Degradation Alerts
- **Layer**: 69 — Data Freshness, Sync Observability & Quality Orchestration
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Build a real-time connector reliability scoring system that predicts degradation before sync failures occur, enabling proactive intervention. Create packages/semantic-core/src/reliability-predictor.ts with ReliabilityPredictor: (1) computeReliabilityScore(connectorId, windowMs=86400000) calculating time-weighted reliability 0–100 from recent sync outcomes (success rate 40%, latency p95 30%, error rate 20%, schema stability 10%), (2) detectDegradationPattern(connectorId) using statistical analysis (Z-score) to identify anomalies in error rate, latency spike, or auth failures before total failure, (3) forecastNextFailure(connectorId) applying exponential smoothing to predict likelihood of next failure within 1h/24h/7d windows, (4) emitProactiveAlert(connectorId, alertType, reason) triggering severity-based alerts (warning: score <70, critical: score <40 or failure forecast >80%), (5) suggestMitigations(connectorId) recommending actions (reduce frequency, check credentials, manual refresh, enable fallback). Create migration 149 (reliability_scores, reliability_alerts, alert_suppressions). Add REST routes: GET /api/v1/connectors/:id/reliability (score + trend + forecast), GET /api/v1/connectors/:id/alerts (recent alerts + mitigation actions), POST /api/v1/connectors/:id/suppress-alert (silence false positives). Add MCP tool: connector-health-forecast (predict reliability issues for Claude agents). Add dashboard components: reliability-gauge.tsx (score + trend sparkline), degradation-predictor-panel.tsx (forecast alerts + confidence), alert-action-logger.tsx (mitigation history). Include 26+ tests (16 unit scoring + 10 integration forecast accuracy).
- **Files**:
  - packages/semantic-core/src/reliability-predictor.ts
  - packages/semantic-core/src/__tests__/reliability-predictor.test.ts
  - packages/semantic-core/src/__tests__/reliability-predictor.integration.test.ts
  - apps/api/src/routes/reliability-scoring.ts
  - apps/api/src/__tests__/reliability-scoring.test.ts
  - apps/api/migrations/149_reliability_alerts.sql
  - apps/mcp-server/src/tools/connector-health-forecast.ts
  - apps/dashboard/components/reliability-gauge.tsx
  - apps/dashboard/components/degradation-predictor-panel.tsx
  - apps/dashboard/components/alert-action-logger.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Enrichment Quality Scoring & Completeness Analysis
- **Layer**: 69 — Data Freshness, Sync Observability & Quality Orchestration
- **Status**: UNWORKED
- **Priority**: Medium
- **Description**: Implement enrichment quality metrics that measure coverage, confidence, freshness, and source diversity for enriched entities. Create packages/semantic-core/src/enrichment-quality-scorer.ts with EnrichmentQualityScorer: (1) scoreEnrichmentCompletenessForEntity(entityId) computing attribute coverage 0–100 (% of attributes populated by enrichment) and required-attribute hit rate, (2) aggregateEnrichmentMetrics(connectorId, period) computing mean completeness per entity type, source reliability (accuracy via feedback + confidence scores), refresh lag (time since last enrichment refresh), (3) detectEnrichmentGaps(entityType, connectorId) identifying systematically unenriched field patterns (e.g., 90% of people missing "company_size"), (4) scoreSourceDiversity(entityId) measuring entropy of enrichment sources (high diversity = lower risk from single source failure), (5) assessEnrichmentROI(connectorId, period) computing token-per-entity cost vs. completeness improvement. Create migration 150 (enrichment_quality_scores, enrichment_gaps, source_reliability_feedback). Add REST routes: GET /api/v1/enrichment/quality/:connectorId (per-entity-type scores), GET /api/v1/enrichment/gaps (missing fields by frequency), GET /api/v1/enrichment/sources/:sourceId/reliability (source accuracy + feedback). Add dashboard page: enrichment-quality/page.tsx with: completeness heatmap (entity type × field), source reliability scorecard, gap frequency histogram, ROI analysis. Include 22+ tests (14 unit quality scoring + 8 integration source reliability).
- **Files**:
  - packages/semantic-core/src/enrichment-quality-scorer.ts
  - packages/semantic-core/src/__tests__/enrichment-quality-scorer.test.ts
  - packages/semantic-core/src/__tests__/enrichment-quality-scorer.integration.test.ts
  - apps/api/src/routes/enrichment-quality.ts
  - apps/api/src/__tests__/enrichment-quality.test.ts
  - apps/api/migrations/150_enrichment_quality.sql
  - apps/dashboard/app/admin/enrichment-quality/page.tsx
  - apps/dashboard/components/completeness-heatmap.tsx
  - apps/dashboard/components/source-reliability-scorecard.tsx
  - apps/dashboard/components/enrichment-gap-histogram.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08

### Task: Sync Parallelism & Concurrency Auto-Optimizer
- **Layer**: 69 — Data Freshness, Sync Observability & Quality Orchestration
- **Status**: UNWORKED
- **Priority**: Medium
- **Description**: Implement an adaptive sync optimizer that automatically tunes connector concurrency, batch sizes, and resource allocation based on observed throughput, latency, and error rates to maximize sync efficiency. Create packages/semantic-core/src/sync-parallelism-optimizer.ts with SyncParallelismOptimizer: (1) recommendConcurrency(connectorId, entityType, historicalMetrics) computing optimal parallel request count using hill-climbing search (maximize throughput/s while keeping p95 latency <threshold), (2) tuneRequestBatchSize(connectorId, currentBatch) adapting batch size based on error rate + payload size to find sweet spot, (3) allocateWorkerPool(workspace, connectorIds) distributing available BullMQ workers across connectors using weighted allocation (prioritize high-entity-count connectors, recently-degraded connectors lower priority), (4) detectOptimizationWindow(connectorId) identifying stable periods (no API changes, no rate limits) suitable for tuning experiments, (5) executeOptimizationExperiment(connectorId, variant) A/B testing a concurrency variant on 10% of next sync, measuring impact on throughput. Create migration 151 (sync_optimization_configs, optimization_experiments, experiment_results). Add REST routes: POST /api/v1/sync-optimizer/tuning/:connectorId (trigger auto-tuning), GET /api/v1/sync-optimizer/config/:connectorId (current settings + recommended), GET /api/v1/sync-optimizer/experiments (A/B test results). Add dashboard components: concurrency-tuning-wizard.tsx (interactive tuning simulator), optimization-history-chart.tsx (throughput improvement over time), experiment-results-table.tsx. Include 20+ tests (12 unit optimization math + 8 integration BullMQ allocation).
- **Files**:
  - packages/semantic-core/src/sync-parallelism-optimizer.ts
  - packages/semantic-core/src/__tests__/sync-parallelism-optimizer.test.ts
  - packages/semantic-core/src/__tests__/sync-parallelism-optimizer.integration.test.ts
  - apps/api/src/routes/sync-optimizer.ts
  - apps/api/src/__tests__/sync-optimizer.test.ts
  - apps/api/migrations/151_sync_optimization.sql
  - apps/dashboard/components/concurrency-tuning-wizard.tsx
  - apps/dashboard/components/optimization-history-chart.tsx
  - apps/dashboard/components/experiment-results-table.tsx
- **Depends on**: nothing
- **Added**: 2026-06-08
