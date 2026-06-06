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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
