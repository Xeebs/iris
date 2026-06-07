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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
