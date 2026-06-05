# Iris

**Business context intelligence for AI tools — MCP-native, token-efficient, no data team required.**

Iris is a self-hosted MCP server that indexes your company's operational data (CRM, docs, data warehouse, SaaS tools), semantically enriches it, and serves it as governed, compressed context to any AI platform your team already uses. The result: your AI tools actually know your business — and do it at a fraction of the token cost.

---

## The Problem

AI tools are everywhere in business, but they're generic. When a sales rep asks Claude *"What's our average deal size for Q1?"* or an ops manager asks *"Which suppliers are on 90-day terms?"*, the AI has no idea what that company's data looks like. The workarounds today are expensive and fragile:

- **Pasting data into prompts** — unscalable, ungoverned, burns tokens
- **Building a custom RAG pipeline** — requires engineers, ongoing maintenance
- **Enterprise semantic layer tools** — designed for data teams, $30K+/year minimums
- **Vendor-locked solutions** — Salesforce Einstein, Microsoft Fabric IQ, Databricks AI/BI — each solves only within their own ecosystem

**The average SMB runs 40+ SaaS applications.** No existing tool provides unified, semantically enriched context across all of them at a price point and setup time that works for a non-technical team.

---

## What Iris Does

Iris sits between your business data and your AI tools:

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Tools Layer                        │
│   Claude  │  ChatGPT  │  Copilot  │  Cursor  │  Custom Agents│
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP (open standard)
┌───────────────────────────▼─────────────────────────────────┐
│                     Iris MCP Server                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │Context Query│  │Access Control│  │ Audit & Governance │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                      Context Engine                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  Retrieval   │  │  Compression  │  │  Cache Manager   │  │
│  │  (vector +   │  │  Pipeline     │  │  (semantic +     │  │
│  │   graph)     │  │               │  │   prefix)        │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                     Semantic Index                           │
│       Entity Graph  │  Metric Registry  │  Business Glossary │
│          Vector Store (pgvector / Qdrant)                    │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                     Connector Layer                          │
│  HubSpot │ Salesforce │ Notion │ Snowflake │ Google Drive │ …│
└─────────────────────────────────────────────────────────────┘
```

1. **Connect** — pre-built connectors sync your CRM, docs, data warehouse, and SaaS tools on a configurable schedule
2. **Index** — entities, relationships, metric definitions, and business terminology are extracted and stored in a semantic graph
3. **Compress** — a four-layer efficiency stack reduces redundant context before anything reaches an LLM
4. **Serve** — a fully MCP-compliant server exposes query tools that any AI platform can call
5. **Govern** — access control and a full audit trail of every context read

---

## Why MCP

The Model Context Protocol has emerged as the open standard for AI tool integration — 97M monthly SDK downloads, supported by Claude, ChatGPT, Copilot, Gemini, and every major coding assistant. Iris is MCP-native from day one, which means it works with any AI tool your team adopts — today or in the future — without any changes to the context server.

Most MCP servers are thin API wrappers. Iris is the first to combine pre-indexed, semantically enriched, token-compressed business context with MCP delivery. That's the whitespace.

---

## Token Efficiency

Token cost is a first-class concern. Iris implements a four-layer efficiency stack:

| Layer | Technique | Estimated Savings |
|-------|-----------|------------------|
| Index-time | Semantic deduplication (cosine ≥ 0.85 threshold) | 30–50% fewer stored entities |
| Index-time | Structured extraction — 2KB CRM record → 200-token semantic entity | 80–90% per record |
| Retrieval | Top-k relevance filtering — only what's needed for the query | Query-specific |
| Cache | Semantic response cache — vector-matched answers for equivalent queries | Near-zero cost on repeated queries |
| Cache | Provider prefix caching — static system context structured for Anthropic/OpenAI cache hits | 90% cost reduction on prefix tokens |

**Estimated aggregate savings: 50–80% token reduction** vs. naive full-context injection.

---

## Connectors

| Connector | Status | Auth | Entity Types |
|-----------|--------|------|--------------|
| HubSpot | Done | OAuth2 | Contact, Company, Deal, Activity |
| Salesforce | Done | OAuth2 | Contact, Account, Opportunity |
| Notion | Done | OAuth2 | Page, Database Row |
| Google Drive | Done | OAuth2 | File, Folder |
| Snowflake | Done | API Key | Table Row (configurable) |
| PostgreSQL | Planned | Connection String | Table Row (configurable) |
| Airtable | Planned | API Key | Record |
| Jira | Planned | OAuth2 | Issue, Project, Sprint |
| Confluence | Planned | OAuth2 | Page, Space |
| Slack | Planned | OAuth2 | Message, Channel |
| Linear | Planned | OAuth2 | Issue, Team, Project |
| NetSuite | Planned | OAuth2 | Transaction, Record |

---

## MCP Tools

The MCP server exposes five tools any AI agent can call:

| Tool | Description |
|------|-------------|
| `query-context` | Semantic search over the indexed entity graph — the primary tool for AI agents |
| `list-entities` | List entities by type with workspace isolation |
| `get-entity` | Fetch a specific entity by ID |
| `get-metric` | Look up a named business metric from the registry |
| `list-glossary` | Return business terminology definitions |

All tools enforce a `contextBudget` token cap, log every call to the audit table, and return structured errors rather than throwing.

---

## Architecture

### Monorepo Structure

```
apps/
  mcp-server/      — MCP-compliant context server (the main product)
  api/             — REST API for dashboard, webhooks, and connector management
  dashboard/       — Next.js admin UI

packages/
  connector-sdk/   — BaseConnector contract, SemanticEntity types, registry
  connectors/      — Individual connector implementations
  core/            — Logger, error types, config loader
  semantic-core/   — Embedding, indexing, retrieval, glossary, metric registry
  cache/           — Semantic cache + prefix cache (Redis-backed)
  compression/     — Context compression pipeline
  graph/           — Knowledge graph interface (Neo4j)
```

### Tech Stack

| Concern | Technology |
|---------|-----------|
| Language | TypeScript (Node.js 20+, strict mode throughout) |
| MCP | Official Anthropic MCP TypeScript SDK |
| API framework | Hono |
| Frontend | Next.js + shadcn/ui |
| Package manager | pnpm workspaces |
| Build system | Turborepo |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| Vector store | pgvector (Postgres) + Qdrant |
| Cache | Redis 7 |
| Queue | BullMQ |
| Auth | Clerk (JWT for REST, API key for MCP) |
| Testing | Vitest + MSW + Playwright |
| Validation | Zod (all inputs, connector configs, env vars) |
| Error handling | neverthrow `Result<T, E>` |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for local Postgres, Redis, and Qdrant)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/Xeebs/iris
cd iris
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Fill in API keys: OpenAI, Clerk, connector OAuth credentials

# 3. Start local services
docker-compose -f infra/docker/docker-compose.yml up -d

# 4. Run database migrations
pnpm db:migrate

# 5. Start all services
pnpm dev
```

### Development Commands

```bash
pnpm dev              # Start all services in watch mode
pnpm build            # Build all packages and apps
pnpm test             # Run all unit tests
pnpm test:integration # Run integration tests (requires Docker)
pnpm typecheck        # Type-check all packages
pnpm lint             # ESLint + Prettier

pnpm mcp:start        # Start just the MCP server
pnpm mcp:inspect      # Open MCP inspector for interactive debugging

pnpm connector:scaffold <name>   # Scaffold a new connector
pnpm connector:test <name>       # Run tests for a specific connector
```

### Adding Iris to Claude Desktop

Once the MCP server is running locally (default: `http://localhost:3001`), add it to your Claude Desktop config:

```json
{
  "mcpServers": {
    "iris": {
      "command": "pnpm",
      "args": ["mcp:start"],
      "cwd": "/path/to/iris"
    }
  }
}
```

---

## Build Status

This project is actively developed by an autonomous Claude Code pipeline (see `scripts/daemon.py`). The pipeline runs continuously, implementing tasks from `pipeline/queue.md` in priority order.

### Completed

| Layer | Component | Tests |
|-------|-----------|-------|
| 0 — Foundation | Package manifests, Turborepo, tsconfig | — |
| 0 — Foundation | Docker infra (Postgres/pgvector, Redis, Qdrant) | — |
| 1 — Core | Logger (pino, structured, child factory) | 10/10 |
| 1 — Core | Error types (IrisError hierarchy, neverthrow) | 9/9 |
| 1 — Core | Config loader (zod env validation) | 8/8 |
| 2 — Connector SDK | Connector registry | 12/12 |
| 2 — Connector SDK | Test utilities (mock factories, shape validators) | — |
| 3 — Connectors | HubSpot connector | 14/14 |
| 3 — Connectors | Notion connector | 13/13 |
| 4 — Semantic Core | Embedding service (OpenAI, batching, PII scrub) | 10/10 |
| 4 — Semantic Core | Vector store (pgvector) | integration |
| 4 — Semantic Core | Indexer (dedup at 0.85 threshold) | 9/9 |
| 4 — Semantic Core | Retrieval engine (graph expansion) | 8/8 |
| 5 — Cache | Semantic cache (Redis, 0.92 threshold) | 12/12 |
| 5 — Cache | Prefix cache manager (24h TTL) | 13/13 |
| 6 — Compression | Compression pipeline (dedup→truncate→serialize) | 19/19 |
| 7 — MCP Server | Bootstrap + 5 tools | 15/15 |
| 8 — API | REST API bootstrap (Hono, Clerk auth) | 9/9 |
| 8 — API | Audit logger (Postgres-backed, cursor pagination) | 9/9 |
| 10 — Dashboard | Next.js scaffold | — |
| 11 — Data Layer | Database schema migrations | — |
| 11 — Data Layer | Glossary service + API | — |
| 11 — Data Layer | Metric registry + API | — |
| 12 — Connectors | Salesforce connector | 13/13 |
| 12 — Connectors | Google Drive connector | — |
| 12 — Connectors | Snowflake connector | 17/17 (97.4%) |
| 12 — Connectors | Connector instance management API | — |

### In Progress / Up Next

- PostgreSQL connector (Phase 1 MVP completion)
- Dashboard UI — connector health, token analytics, index status pages
- BullMQ sync job queue
- Phase 2 connectors — Airtable, Jira, Confluence, Slack, Linear

Monitor pipeline progress in real time:

```bash
iris monitor   # live terminal dashboard
iris status    # one-line daemon status
iris logs      # tail the current build log
```

---

## Roadmap

### Phase 0 — Foundation ✓
Core packages, connector framework, semantic index, MCP server scaffold.

### Phase 1 — MVP (in progress)
6 production connectors, business glossary + metric registry, semantic + prefix cache, compression pipeline, REST API, admin dashboard.

### Phase 2 — Growth
6 additional connectors (Airtable, Jira, Confluence, NetSuite, Slack, Linear), role-based context segmentation, knowledge graph visualization, webhook-driven real-time sync, self-hosted Docker deployment.

### Phase 3 — Scale
Multi-tenant / white-label, proactive context surfacing, agent workflow templates, enterprise features (SSO, audit export, SLA).

---

## Writing a Connector

Every connector extends `BaseConnector` from `@iris/connector-sdk`:

```typescript
import { BaseConnector, SemanticEntity, ConnectorManifest } from '@iris/connector-sdk';

class MyConnector extends BaseConnector<MyConfig> {
  async connect(config: MyConfig): Promise<Result<void, ConnectorError>> { ... }
  async *sync(options: SyncOptions): AsyncGenerator<SemanticEntity> { ... }
  async getSchema(): Promise<ConnectorSchema> { ... }
  async healthCheck(): Promise<HealthStatus> { ... }
}

export const manifest: ConnectorManifest = {
  id: 'my-connector',
  name: 'My Connector',
  auth: { type: 'oauth2', scopes: ['read'] },
  entityTypes: ['record'],
  configSchema: z.object({ ... }),
  rateLimits: { requestsPerSecond: 10 },
};
```

Scaffold a new connector:

```bash
pnpm connector:scaffold <name>
```

See `.claude/rules/connector-patterns.md` for the full contract including sync patterns, OAuth token handling, entity transformation rules, and test requirements.

---

## Target Users

**The Ops-Aware Founder / COO** — 20–150 person company, uses AI tools daily, frustrated that Claude doesn't know their business, no data team. Iris gives them governed business context without hiring an engineer.

**The RevOps / BizOps Manager** — 150–2,000 person company, responsible for making AI tools actually useful for the team, managing a BI stack and CRM. Iris unifies context across those systems and measures token savings.

**The Developer / AI Engineer** — building internal agents or tools, wants a battle-hardened context server they don't have to build from scratch, values open APIs and extensibility.

---

## License

MIT
