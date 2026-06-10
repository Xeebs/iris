# Iris

**Business context intelligence for AI tools — MCP-native, token-efficient, no data team required.**

Iris is a self-hosted context server that indexes a company's operational data (CRM, docs, data warehouse, SaaS tools), semantically enriches it, and serves it as governed, compressed context to any AI tool over the [Model Context Protocol](https://modelcontextprotocol.io). The goal: your AI tools actually know your business, at a fraction of the token cost of pasting raw data into prompts.

---

## What we're trying to accomplish

AI assistants are everywhere in business, but they're generic. When a sales rep asks Claude *"What's our average deal size for Q1?"*, the AI has no idea what that company's data looks like. Today's workarounds all fail somewhere:

- **Pasting data into prompts** — unscalable, ungoverned, burns tokens
- **Custom RAG pipelines** — require engineers and ongoing maintenance
- **Enterprise semantic layers** — built for data teams, $30K+/year minimums
- **Vendor-locked AI** (Einstein, Fabric IQ, Databricks AI/BI) — each only works inside its own ecosystem

The average SMB runs 40+ SaaS applications. Nothing unifies semantically enriched context across them at a price and setup effort that works for a non-technical team. Iris aims to be that layer — and because it speaks MCP, it works with Claude, ChatGPT, Copilot, Cursor, or any custom agent, today or in the future, without changes to the server.

Most MCP servers are thin API wrappers. Iris combines **pre-indexed, semantically enriched, token-compressed** business context with MCP delivery:

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Tools Layer                        │
│   Claude  │  ChatGPT  │  Copilot  │  Cursor  │ Custom Agents │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP (open standard)
┌───────────────────────────▼─────────────────────────────────┐
│                     Iris MCP Server                          │
│   context query tools │ access control │ audit & governance  │
└───────────────────────────┬─────────────────────────────────┘
┌───────────────────────────▼─────────────────────────────────┐
│                      Context Engine                          │
│   retrieval (vector+graph) │ compression │ semantic cache    │
└───────────────────────────┬─────────────────────────────────┘
┌───────────────────────────▼─────────────────────────────────┐
│                     Semantic Index                           │
│   entity graph │ metric registry │ business glossary         │
│              vector store (pgvector / Qdrant)                │
└───────────────────────────┬─────────────────────────────────┘
┌───────────────────────────▼─────────────────────────────────┐
│                     Connector Layer                          │
│   HubSpot │ Salesforce │ Notion │ Snowflake │ Drive │ …      │
└─────────────────────────────────────────────────────────────┘
```

1. **Connect** — pre-built connectors sync CRM, docs, warehouse, and SaaS data on a schedule
2. **Index** — entities, relationships, metrics, and terminology are extracted into a semantic graph
3. **Compress** — a multi-layer efficiency stack strips redundancy before anything reaches an LLM
4. **Serve** — an MCP-compliant server exposes query tools any AI platform can call
5. **Govern** — workspace-scoped API keys, role-based access, and an audit trail of every context read

### Token efficiency, by design

Token cost is a first-class concern, attacked at every layer:

| Layer | Technique | Target |
|-------|-----------|--------|
| Index-time | Semantic deduplication (cosine ≥ 0.85) | 30–50% fewer stored entities |
| Index-time | Structured extraction — 2KB raw CRM record → ~200-token semantic entity | 80–90% per record |
| Retrieval | Top-k relevance filtering within an explicit `contextBudget` | query-specific |
| Cache | Semantic response cache (cosine ≥ 0.92) for equivalent queries | near-zero repeat cost |
| Cache | Static-first context layout for provider prefix-cache hits | ~90% on prefix tokens |

The acceptance bar for the current milestone (below) is **≥ 70% measured token savings** versus pasting the equivalent raw fixture data — measured, not estimated.

---

## Where the project actually is

This repo is built almost entirely by an **autonomous Claude Code pipeline** (`scripts/daemon.py`) that runs continuously on a Raspberry Pi, selecting tasks from `pipeline/queue.md`, implementing, testing, and pushing. 340+ cycles in, that produced a lot of surface area — ~1,350 TypeScript files, 14 connector implementations, 20+ MCP tools, a REST API, and a dashboard scaffold — much of it tested in isolation but **not yet proven as one working product**.

So the pipeline is currently frozen on a single milestone, defined in [`docs/VERTICAL_SLICE.md`](docs/VERTICAL_SLICE.md):

> **One user connects HubSpot, asks a business question through Iris via MCP, and gets a correct answer that costs measurably fewer tokens than pasting the raw data.**

The proof is `scripts/slice-demo.sh` — a single command that, from a fresh database, runs the whole chain:

```
connect → sync → index → serve → query → answer → measure
```

It creates a workspace and a fixture-mode HubSpot connector via the REST API, syncs and indexes the entities, starts the MCP server with a scoped API key, asks 5 canonical business questions over a real MCP stdio client, asserts the answers contain the right facts within the token budget, and prints the token-savings report. It must pass **twice in a row** and run green in CI (the `slice-demo` workflow) before any feature work resumes.

**Status: not yet achieved** — the demo is being hardened in CI right now. Until `docs/VERTICAL_SLICE.md` says `ACHIEVED`, treat every capability listed in this README as *implemented but unproven end-to-end*.

---

## Monorepo layout

```
apps/
  mcp-server/      — MCP-compliant context server (the product)
  api/             — REST API: dashboard, webhooks, connector management
  dashboard/       — Next.js admin UI

packages/
  connector-sdk/   — BaseConnector contract, SemanticEntity types, registry
  connectors/      — Individual connector implementations
  core/            — Logger, error types, config loader
  semantic-core/   — Embedding, indexing, retrieval, glossary, metric registry
  cache/           — Semantic + prefix cache (Redis-backed)
  compression/     — Context compression pipeline
  graph/           — Knowledge graph interface (Neo4j)
```

| Concern | Technology |
|---------|-----------|
| Language | TypeScript, strict mode (Node.js 20+) |
| MCP | Official MCP TypeScript SDK¹ |
| API framework | Hono |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim; deterministic hash provider for demos/tests) |
| Vector store | pgvector (Postgres) + Qdrant |
| Cache | Redis 7 |
| Build | pnpm workspaces + Turborepo |
| Validation / errors | zod everywhere; neverthrow `Result<T, E>` |
| Testing | Vitest + MSW + Playwright |

¹ Tool registration goes through `apps/mcp-server/src/register-tool.ts` rather than the SDK's generic `registerTool()` — the SDK 1.29 × zod 3.25 generics blow up TypeScript's checker (4GB+ OOM). See the helper's doc comment before touching tool registration.

### Connectors

Implemented (fixture-tested, pending end-to-end validation): **HubSpot, Salesforce, Notion, Google Drive, Snowflake**, and others in `packages/connectors/`. Planned next: PostgreSQL, Airtable, Jira, Confluence, Slack, Linear. Every connector extends `BaseConnector` (connect / sync / getSchema / healthCheck), transforms raw records into compact `SemanticEntity` objects — never raw API responses — and ships with MSW-mocked tests. See `.claude/rules/connector-patterns.md` for the contract and `pnpm connector:scaffold <name>` to start one.

### MCP tools

The primary tool is `query-context` — semantic search over the indexed graph within a token budget. Around it sit `list-entities`, `get-entity`, `get-metric`, `list-glossary`, and a set of advanced tools (aggregation, comparison, anomaly detection, trend analysis, federated queries, streaming context). All tools validate input with zod, enforce `contextBudget`, log to the audit table, and return structured errors instead of throwing.

---

## Getting started

Prerequisites: Node.js 20+, pnpm 9+, Docker.

```bash
git clone https://github.com/Xeebs/iris && cd iris
pnpm install
cp .env.example .env.local                                  # fill in keys as needed
docker-compose -f infra/docker/docker-compose.yml up -d     # Postgres/pgvector, Redis, Qdrant
pnpm db:migrate
pnpm dev
```

The single most useful command — the end-to-end proof:

```bash
bash scripts/slice-demo.sh    # exit 0 = the whole chain works, with a token report
```

Other commands:

```bash
pnpm build / pnpm test / pnpm typecheck / pnpm lint
pnpm test:integration            # requires Docker services
pnpm mcp:start                   # start just the MCP server
pnpm mcp:inspect                 # MCP inspector for interactive debugging
pnpm connector:scaffold <name>   # scaffold a new connector
```

### Using Iris from Claude Desktop

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

## The autonomous pipeline

Iris doubles as a long-running experiment in autonomous software development. A daemon spawns Claude Code sessions in a loop; each session checks CI health (no feature work on red CI), picks the top task from `pipeline/queue.md`, implements it under the rules in `.claude/rules/`, runs tests, and pushes. A task-researcher agent refills the queue by scanning the PRD and code for gaps. State lives in `pipeline/state.json`; history in `pipeline/changelog.md` and `pipeline/queue-archive.md`.

The vertical-slice freeze exists because that loop is excellent at producing breadth and needs an explicit forcing function for depth — a lesson now encoded in `docs/VERTICAL_SLICE.md` and the `slice-demo` CI gate.

---

## Who it's for

- **The ops-aware founder/COO** (20–150 people): uses AI daily, has no data team, wants Claude to know the business without hiring an engineer.
- **The RevOps/BizOps manager** (150–2,000 people): responsible for making AI tools useful across a CRM + BI stack, needs governance and measurable token spend.
- **The developer building internal agents**: wants a context server with open APIs and an extensible connector SDK instead of building RAG from scratch.

## License

MIT
