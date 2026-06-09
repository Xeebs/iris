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

### CURRENT FOCUS — Vertical Slice ONLY (overrides all queue breadth)

**Read `docs/VERTICAL_SLICE.md` at the start of every cycle.** While its status line reads `NOT ACHIEVED`, the pipeline is in **slice mode**:

- Task selection is restricted to the **CI Green Gate** and tasks in **Layer 78 — Vertical Slice** in `pipeline/queue.md`. All other UNWORKED tasks are frozen — do not select them, regardless of priority.
- The task-researcher may only generate tasks that unblock or harden the slice (fixing a broken link in the connect → sync → index → serve → query → measure chain). It must not generate feature, dashboard, coverage-padding, or enterprise tasks.
- "Done" for the slice is defined exclusively by the acceptance criteria in `docs/VERTICAL_SLICE.md` — a single command (`scripts/slice-demo.sh`) proving the end-to-end flow from a clean database, twice, with a token-savings report.
- If a slice task reveals broken code elsewhere (unmounted route, broken migration, stub function on the slice path), fixing it **is** slice work — do it.
- Only when every acceptance criterion is met, CI includes a green `slice-demo` job, and the status line in `docs/VERTICAL_SLICE.md` is flipped to `ACHIEVED`, may the pipeline resume normal queue-driven breadth work.

Rationale: 344 cycles produced enormous surface area but the core value proposition has never been demonstrated end to end. Working product first; features second.

### CI Green Gate — MANDATORY, Highest Priority

**Before selecting any new feature task, the pipeline MUST verify that GitHub CI is passing.**

Run `gh run list --limit 5` and check the most recent run status:
- If **any run is failing**: immediately treat fixing it as a `Critical` priority task that supersedes all other queue items. Do not implement new features while CI is red.
- Diagnose the failure with `gh run view <run-id>` and `gh run view <run-id> --log-failed`.
- Fix the root cause, commit, push, then wait for the next run to confirm green before proceeding.
- Repeat this check-fix-verify loop until CI is confirmed passing.
- Only after CI is green may the pipeline select the next feature task from the queue.

**After every commit & push** (Phase 5), pause and re-run the CI green gate check before starting the next task. A pushed commit that breaks CI must be fixed in the same pipeline cycle.

This rule overrides all other priority ordering. A product with failing CI is not a working product.

### Startup — Resume Check

Read `pipeline/state.json`. Identify `current_phase` and `active_task`. If a task is mid-flight, resume from that phase. If IDLE, start at Phase 1.

### Phase 0 — CI Green Gate Check

Run `gh run list --limit 5`. If the most recent run is not `success`, enter the CI fix loop (see CI Green Gate above) before proceeding to Phase 1.

### Phase 1 — Task Research (conditional)

Spawn the **task-researcher** subagent whenever fewer than 3 UNWORKED items remain in `pipeline/queue.md`. There is no date restriction — run it every cycle if needed until new tasks are added. The researcher scans the PRD, existing stubs, and TODO comments to generate 3–5 new tasks. It updates `pipeline/state.json` with `last_research: <today>`. **In slice mode (see CURRENT FOCUS), count only UNWORKED Layer 78 tasks, and the researcher may only generate slice-path tasks.**

### Phase 2 — Plan

Select the top UNWORKED High-priority task from `pipeline/queue.md` — **in slice mode, only from Layer 78 — Vertical Slice**. Read the relevant section of `docs/PRD.md`, the applicable `.claude/rules/*.md` files, and any existing stub code. Produce a concrete implementation plan and mark the task `IN_PROGRESS` in `pipeline/queue.md`. Write `pipeline/state.json` with `current_phase: PLAN, active_task: <task-name>`.

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
2. `git commit -m "feat(<package>): <description>\n\nCo-Authored-By: <the model you are actually running as, e.g. Claude Opus 4.8> <noreply@anthropic.com>"`
3. `git push origin main`
4. Mark task `COMMITTED` in `pipeline/queue.md`, then run `python3 scripts/archive-queue.py` to move it to `pipeline/queue-archive.md`
5. Append a one-line entry to `pipeline/changelog.md`
6. Write `pipeline/state.json` with `current_phase: COMMITTED, active_task: null`
7. **Run the CI Green Gate check** — wait for the pushed run to complete and confirm it passes before proceeding
8. Immediately proceed to Phase 2 for the next task — do **not** stop

### When to Stop

**Only stop** under one of these two conditions:
1. **Rate limited** — write `rate_limit_hit: true` and current phase/task to state, then exit.
2. **Queue exhausted after research** — task-researcher ran and produced 0 new tasks. Write `current_phase: IDLE` to state, then exit. **In slice mode, before declaring exhaustion: run `scripts/slice-demo.sh` (if it exists). If it fails, each failure is a new slice task — add it and continue. If it passes all acceptance criteria in `docs/VERTICAL_SLICE.md`, flip its status line to `ACHIEVED`, commit, and exit IDLE so the owner can verify by hand.**

Never stop after a single task. Never stop because `last_research` is today — always attempt research when the queue is low. Drive all work forward until genuinely blocked.

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
