# Iris — Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Tools Layer                        │
│   Claude  │  ChatGPT  │  Copilot  │  Cursor  │  Custom      │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP (Model Context Protocol)
┌───────────────────────────▼─────────────────────────────────┐
│                     Iris MCP Server                          │
│                    apps/mcp-server/                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │Context Query│  │ Access Control│  │ Audit Log          │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Context Engine                             │
│           packages/semantic-core/ + packages/cache/          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  Retrieval   │  │  Compression  │  │  Cache Manager   │  │
│  │  (vector +   │  │  Pipeline     │  │  (semantic +     │  │
│  │   graph)     │  │ packages/     │  │   prefix)        │  │
│  │              │  │ compression/  │  │                  │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Semantic Index                             │
│                  packages/semantic-core/                      │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Entity    │  │  Metric      │  │  Business            │ │
│  │  Graph     │  │  Registry    │  │  Glossary            │ │
│  │packages/   │  │              │  │                      │ │
│  │graph/      │  │              │  │                      │ │
│  └────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐    │
│  │     Vector Store (pgvector / Qdrant)                 │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Connector Layer                            │
│                packages/connectors/                          │
│  HubSpot │ Salesforce │ Notion │ Snowflake │ Postgres │ ...  │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### ADR-001: MCP as the primary interface
MCP is the emerging standard for AI tool integration. All context delivery goes through the MCP server. See `docs/adr/001-mcp-first.md`.

### ADR-002: Open core model
Core indexing and connector framework are open source (MIT). Multi-tenancy, advanced caching, and admin dashboard are closed source. See `docs/adr/002-open-core.md`.

### ADR-003: pgvector as default vector store, Qdrant as optional
pgvector keeps the infrastructure footprint minimal for self-hosted customers. Qdrant is available for high-scale deployments. See `docs/adr/003-vector-store.md`.

## Token Efficiency Stack

Four layers of token efficiency (see PRD.md section 7 for full detail):

1. **Index-time compression** — semantic dedup, structured extraction
2. **Retrieval-time filtering** — relevance scoring, top-k, context budget
3. **Caching** — provider prefix cache, semantic response cache
4. **Delivery optimization** — progressive context, delta updates

## Data Flow: Query

```
User asks AI tool: "What are our top deals?"
        │
        ▼
AI tool calls MCP tool: query-context(query="top deals")
        │
        ▼
MCP Server: authenticate + authorize
        │
        ▼
Context Engine:
  1. Check semantic cache — cache hit? Return cached response
  2. Decompose query → entity types: [deal]
  3. Vector search → top-k deal entities
  4. Graph traversal → related contacts, companies
  5. Compression pipeline → token-efficient context string
  6. Return within contextBudget
        │
        ▼
AI tool receives compact, accurate context
AI tool generates response grounded in real business data
```

## Data Flow: Sync

```
Connector scheduled sync (hourly/daily/real-time)
        │
        ▼
Connector.sync() → AsyncGenerator<SemanticEntity>
        │
        ▼
For each entity:
  1. Transform raw API record → SemanticEntity
  2. Generate embedding (OpenAI / local)
  3. Semantic deduplication check
  4. Upsert into vector store
  5. Update entity graph (relationships)
  6. Invalidate semantic cache entries for affected entities
```
