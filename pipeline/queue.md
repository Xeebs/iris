# Iris — Build Pipeline Queue

Tasks are listed in execution order, layer by layer. The pipeline works top-to-bottom, selecting the first UNWORKED High task, then Medium.

**Statuses**: `UNWORKED` → `IN_PROGRESS` → `TESTING` → `COMMITTED` | `DEPRIORITIZED`

---

## Layer 0: Foundation

### Task: Package Manifests
- **Layer**: 0 — Foundation
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/core/src/logger.ts using pino. Export a typed logger with info/warn/error/debug methods. Support structured metadata as second argument. Export a child logger factory for connector-scoped logging.
- **Files**:
  - packages/core/src/logger.ts
  - packages/core/src/__tests__/logger.test.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

### Task: Error Types
- **Layer**: 1 — Core
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/core/src/errors.ts. Define IrisError base class, ConnectorError (retryable flag), IndexerError, CacheError, MCPError. Use neverthrow for Result<T,E> wrappers. Export err() and ok() helpers.
- **Files**:
  - packages/core/src/errors.ts
  - packages/core/src/__tests__/errors.test.ts
- **Depends on**: Package Manifests
- **Added**: 2026-06-04

### Task: Config Loader
- **Layer**: 1 — Core
- **Status**: UNWORKED
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
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/connector-sdk/src/registry.ts. A class that holds registered ConnectorManifests, can look up by id, list all registered connectors, and validate a config against the connector's configSchema. Include unit tests with 2+ connectors.
- **Files**:
  - packages/connector-sdk/src/registry.ts
  - packages/connector-sdk/src/__tests__/registry.test.ts
- **Depends on**: Error Types
- **Added**: 2026-06-04

### Task: Connector Test Utilities
- **Layer**: 2 — Connector SDK
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/embedding.ts. Wrap OpenAI text-embedding-3-small. Accept a batch of SemanticEntity objects, build the embedding input string per embedding-patterns.md rules (type:label; attrs), call the API in batches of 100, return float32 vectors. Log latency and token counts. Skip PII fields.
- **Files**:
  - packages/semantic-core/src/embedding.ts
  - packages/semantic-core/src/__tests__/embedding.test.ts
- **Depends on**: Package Manifests, Logger
- **Added**: 2026-06-04

### Task: Vector Store Interface
- **Layer**: 4 — Semantic Core
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/semantic-core/src/vector-store.ts. Define a VectorStore interface with upsert(entities, vectors), search(queryVector, topK, filter), and delete(ids). Implement PgvectorStore using postgres + pgvector. Write integration tests (Vitest, real Postgres via docker-compose).
- **Files**:
  - packages/semantic-core/src/vector-store.ts
  - packages/semantic-core/src/__tests__/vector-store.integration.test.ts
- **Depends on**: Package Manifests, Logger
- **Added**: 2026-06-04

### Task: Indexer Implementation
- **Layer**: 4 — Semantic Core
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Complete the flushBatch implementation in packages/semantic-core/src/indexer.ts. Wire up: embedding generation → cosine similarity dedup check → upsert to vector store → emit cache invalidation events. Respect the 0.85 dedup threshold from embedding-patterns.md. Add full unit tests.
- **Files**:
  - packages/semantic-core/src/indexer.ts (update existing)
  - packages/semantic-core/src/__tests__/indexer.test.ts
- **Depends on**: Embedding Service, Vector Store Interface
- **Added**: 2026-06-04

### Task: Retrieval Engine
- **Layer**: 4 — Semantic Core
- **Status**: UNWORKED
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
- **Status**: UNWORKED
- **Priority**: High
- **Description**: Implement packages/cache/src/semantic-cache.ts. Redis-backed cache. On lookup: generate query embedding, scan Redis for vectors with cosine similarity ≥ 0.92, return cached response if hit. On write: store query vector + response with TTL. On invalidate: remove entries related to a set of entity IDs. Full unit tests with mocked Redis.
- **Files**:
  - packages/cache/src/semantic-cache.ts (update existing)
  - packages/cache/src/__tests__/semantic-cache.test.ts
- **Depends on**: Embedding Service, Config Loader
- **Added**: 2026-06-04

### Task: Prefix Cache Manager
- **Layer**: 5 — Cache
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
- **Status**: UNWORKED
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
