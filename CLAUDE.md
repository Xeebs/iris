# Iris — Claude Code Instructions

Iris is a platform-agnostic business context intelligence layer. It indexes, semantically enriches, and serves business operational data to any AI tool via MCP (Model Context Protocol), with a focus on token efficiency and SMB/mid-market usability.

## Project Overview

- **Language:** TypeScript (Node.js 20+)
- **Primary output:** MCP server + REST API + Next.js dashboard
- **Package manager:** pnpm (workspaces)
- **Monorepo structure:** `packages/` for shared libs, `apps/` for deployable services

## Architecture Summary

```
apps/
  mcp-server/      ← MCP-compliant context server (main product)
  api/             ← REST/GraphQL API for dashboard and webhooks
  dashboard/       ← Next.js admin UI
packages/
  connector-sdk/   ← BaseConnector, SemanticEntity types, shared connector utilities
  connectors/      ← Individual connector implementations (hubspot/, salesforce/, etc.)
  core/            ← Shared logger, error types, config loader
  semantic-core/   ← Indexing, embedding, entity extraction, retrieval
  cache/           ← Semantic + prefix cache implementation
  compression/     ← Context compression pipeline
  graph/           ← Knowledge graph (Neo4j interface)
```

## Development Commands

```bash
pnpm dev              # Start all services in dev mode
pnpm build            # Build all packages and apps
pnpm test             # Run all tests
pnpm lint             # ESLint + Prettier check
pnpm typecheck        # tsc --noEmit across all packages

# Connector-specific
pnpm connector:scaffold <name>   # Scaffold a new connector
pnpm connector:test <name>       # Run connector integration tests

# MCP server
pnpm mcp:start        # Start MCP server locally
pnpm mcp:inspect      # Open MCP inspector for debugging
```

## Key Conventions

- See `.claude/rules/code-style.md` for TypeScript style guide
- See `.claude/rules/connector-patterns.md` for connector implementation patterns
- See `.claude/rules/testing.md` for test conventions
- See `.claude/rules/api-conventions.md` for API design rules
- See `.claude/rules/embedding-patterns.md` for embedding model, batching, and threshold rules

## Environment Setup

1. Copy `.env.example` to `.env.local`
2. Run `pnpm install`
3. Run `docker-compose -f infra/docker/docker-compose.yml up -d` to start local Postgres, Redis, Qdrant
4. Run `pnpm db:migrate` to run database migrations
5. Run `pnpm dev` to start all services

## Critical Files

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/server.ts` | MCP server entry point |
| `packages/connector-sdk/src/base-connector.ts` | All connectors extend this |
| `packages/semantic-core/src/indexer.ts` | Core indexing pipeline |
| `packages/cache/src/semantic-cache.ts` | Semantic response cache |
| `packages/compression/src/pipeline.ts` | Context compression chain |

## Autonomous Pipeline Protocol

The Iris build pipeline runs continuously via `scripts/daemon.py`. The daemon fires `claude --dangerously-skip-permissions` in a loop, driving the project forward from the current empty scaffold toward a working MVP.

### Startup — Resume Check

Read `pipeline/state.json`. Identify `current_phase` and `active_task`. If a task is mid-flight, resume from that phase. If IDLE, start at Phase 1.

### Phase 1 — Task Research (conditional)

Spawn the **task-researcher** subagent if: (a) fewer than 3 UNWORKED items remain in `pipeline/queue.md` AND (b) `last_research` in state is not today. Otherwise skip to Phase 2.

The researcher scans the PRD, existing stubs, and TODO comments to generate 3–5 new tasks. It updates `pipeline/state.json` with `last_research: <today>`.

### Phase 2 — Plan

Select the top UNWORKED High-priority task from `pipeline/queue.md`. Read the relevant section of `docs/PRD.md`, the applicable `.claude/rules/*.md` files, and any existing stub code. Produce a concrete implementation plan and mark the task `IN_PROGRESS` in `pipeline/queue.md`. Write `pipeline/state.json` with `current_phase: PLAN, active_task: <task-name>`.

### Phase 3 — Implement

Spawn the appropriate subagent for the task type:
- Connector tasks → **connector-builder**
- MCP tools → **mcp-tool-designer**
- DB migrations → **migration-writer**
- Schema mapping → **schema-mapper**
- General TypeScript → the orchestrator itself

Write all implementation files following `.claude/rules/code-style.md`. No raw API responses, no `any`, no floating promises. Write `pipeline/state.json` with `current_phase: IMPLEMENT`.

### Phase 4 — Test

Run `pnpm typecheck` and `pnpm test --filter=<affected-package>`. If tests fail, attempt one fix cycle (re-spawn the builder with the failure output). After a second failure, mark the task `DEPRIORITIZED` and move on. Write a brief pass/fail note to `pipeline/tasks/<task-name>/test-result.md`. Write `pipeline/state.json` with `current_phase: TEST`.

### Phase 5 — Commit & Push

If tests pass:
1. `git add` all affected files (never `git add -A`)
2. `git commit -m "feat(<package>): <description>\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`
3. `git push origin main`
4. Mark task `COMMITTED` in `pipeline/queue.md`
5. Append a one-line entry to `pipeline/changelog.md`
6. Write `pipeline/state.json` with `current_phase: COMMITTED, active_task: null`
7. Immediately proceed to Phase 2 for the next task — do **not** stop

### When to Stop

**Only stop** under one of these two conditions:
1. **Rate limited** — write `rate_limit_hit: true` and current phase/task to state, then exit.
2. **Queue exhausted** — no UNWORKED High or Medium tasks. Write `current_phase: IDLE` to state, then exit.

Never stop after a single task. Drive all work forward until genuinely blocked.

---

## Connector Development

Every new connector must:
1. Extend `BaseConnector<TConfig, TEntity>` from `packages/connector-sdk`
2. Implement: `connect()`, `sync()`, `getSchema()`, `healthCheck()`
3. Include a `connector.test.ts` with mocked API responses
4. Export a `ConnectorManifest` (name, icon, configSchema, OAuth config)
5. Live in `packages/connectors/<name>/`

Use `/project:new-connector` slash command to scaffold.

## Token Efficiency Rules

- Never return raw records from connectors — always transform to `SemanticEntity` format
- All MCP responses must respect the `contextBudget` parameter (default: 2000 tokens)
- System-level context (glossary, metric defs) must be structured for prefix cache hits — keep it static, put it first
- Log token estimates for every MCP response to the audit table

## Testing Requirements

- Unit tests: all pure functions in `packages/`
- Integration tests: all connectors (use MSW for API mocking)
- E2E tests: critical MCP tool flows (Playwright)
- Minimum coverage: see `.claude/rules/testing.md` for per-package targets (80% packages, 75% mcp-server, 70% api, 50% dashboard)
