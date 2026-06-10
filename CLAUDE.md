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

### CURRENT FOCUS — Slice 2: Iris in Real Use (overrides all queue breadth)

**Read `docs/SLICE_2.md` at the start of every cycle.** While its status line reads `NOT ACHIEVED`, the pipeline is in **slice 2 mode**:

- Task selection is restricted to the **CI Green Gate**, tasks in **Layer 79 — Slice 2** in `pipeline/queue.md`, and finishing the in-flight **Layer 77** route-mounting task (which never takes priority over an UNWORKED Layer 79 task). All other UNWORKED tasks are frozen — do not select them, regardless of priority.
- The task-researcher may only generate tasks that unblock or harden Slice 2 (real embeddings, real data source, eval accuracy, onboarding golden path, real MCP client connection). It must not generate feature, dashboard-breadth, coverage-padding, or enterprise tasks.
- "Done" is defined exclusively by the acceptance criteria in `docs/SLICE_2.md` — `scripts/slice2-demo.sh` proving the chain with real embeddings and a real data source, an eval harness at ≥90% accuracy and ≥70% token savings, twice from clean state, green in CI.
- If a slice task reveals broken code elsewhere (dimension mismatch, broken transformer, dead dashboard page on the golden path), fixing it **is** slice work — do it.
- The final acceptance criterion (owner uses Iris from their own Claude Code session) is **owner-verified and not waivable** — the pipeline must never flip it or the status line. When every script-verifiable criterion is green, write `current_phase: AWAITING_OWNER` to state and exit; the owner flips the status line personally.
- Slice 1 (`docs/VERTICAL_SLICE.md`) is ACHIEVED and its `slice-demo` CI job is the regression guard for the plumbing — keep it green, never weaken it.

Rationale: Slice 1 proved the plumbing against fixtures with fake embeddings and a scripted client. Slice 2 makes every fake link real: real data, real vectors, real client, measured accuracy. After Slice 2 comes a prune-and-consolidate pass — not more breadth.

### CI Green Gate — MANDATORY, Highest Priority

**No feature work happens on red CI.** The check itself is done by the **daemon, not by you**: before spawning each session it queries GitHub Actions and injects a `CI STATUS` line into your prompt (it also waits out in-progress runs so you are never spawned mid-run).

- Prompt says **GREEN** → skip all `gh` checks and go straight to task selection.
- Prompt says **RED** → fixing that run is your first and only priority. Diagnose with `gh run view <run-id> --log-failed`, fix the root cause, commit, push, then **exit cleanly** — the daemon waits for the new run and respawns you with the fresh CI status.
- No CI line in the prompt (daemon couldn't check) → run `gh run list --limit 3` once yourself and act on the result.

**Never poll CI in a loop in-session** (no `sleep`/`gh run watch` cycles — each poll costs a tool call and a turn; the daemon does the same wait for free). After pushing, do not wait for the run: continue or exit per the session batch rule, and trust the daemon to route the next session to a fix if the push broke CI.

This rule overrides all other priority ordering. A product with failing CI is not a working product.

### Startup — Resume Check

Read `pipeline/state.json`. Identify `current_phase` and `active_task`. If a task is mid-flight, resume from that phase. If IDLE, start at Phase 1.

### Phase 0 — CI Green Gate Check

Read the `CI STATUS` line the daemon put in your prompt and act per the CI Green Gate section above. Only run `gh run list` yourself if the prompt carries no CI status.

### Phase 1 — Task Research (conditional)

Spawn the **task-researcher** subagent whenever fewer than 3 UNWORKED items remain in `pipeline/queue.md`. There is no date restriction — run it every cycle if needed until new tasks are added. The researcher scans the PRD, existing stubs, and TODO comments to generate 3–5 new tasks. It updates `pipeline/state.json` with `last_research: <today>`. **In slice 2 mode (see CURRENT FOCUS), count only UNWORKED Layer 79 tasks, and the researcher may only generate slice-2-path tasks.**

### Phase 2 — Plan

Select the top UNWORKED High-priority task from `pipeline/queue.md` — **in slice 2 mode, only from Layer 79 — Slice 2 (or the in-flight Layer 77 task if no Layer 79 task is UNWORKED)**. Read the relevant section of `docs/PRD.md`, the applicable `.claude/rules/*.md` files, and any existing stub code. Produce a concrete implementation plan and mark the task `IN_PROGRESS` in `pipeline/queue.md`. Write `pipeline/state.json` with `current_phase: PLAN, active_task: <task-name>`.

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
7. Do **not** poll CI for the pushed run — the daemon verifies it between sessions (see CI Green Gate)
8. If this was your **third committed task this session**, exit cleanly now (the daemon respawns a fresh session in seconds). Otherwise proceed to Phase 2 for the next task

### Token-Efficient Tool Use — applies to every session and subagent

Tool output lands in your context and is paid for on every subsequent turn. Keep it small:

- **Tests**: `pnpm test --filter=<pkg> 2>&1 | tail -40` — never dump a full vitest run. If you need more of a failure, re-run only the failing file: `pnpm vitest run <file> 2>&1 | tail -60`.
- **Typecheck/build**: pipe through `| tail -25`. Success needs one line; failures are at the end anyway.
- **Reading files**: never read a file >400 lines in full — read the relevant range, or `grep -n` first and read around the hits.
- **Searching**: prefer `grep -l` / `grep -c` / `grep -m 5` over unbounded matches; `head`/`tail` every listing.
- **Logs/JSON**: never `cat` logs or large JSON; use `tail`, `python3 -c` extraction, or `--jq` filters on `gh`.

### When to Stop

**Stop** under any of these conditions:
0. **Task batch complete** — you have committed 3 tasks this session. Exit cleanly; the daemon respawns a fresh session in seconds (short sessions keep context lean — a long session pays for its entire history on every turn).
1. **Rate limited** — write `rate_limit_hit: true` and current phase/task to state, then exit.
2. **Queue exhausted after research** — task-researcher ran and produced 0 new tasks. Write `current_phase: IDLE` to state, then exit. **In slice 2 mode, before declaring exhaustion: run `scripts/slice2-demo.sh` (if it exists). If it fails, each failure is a new slice task — add it and continue. If every script-verifiable criterion in `docs/SLICE_2.md` passes, write `current_phase: AWAITING_OWNER` and exit — the owner-verified criterion and the status-line flip belong to the owner alone; never flip them yourself.**

Never stop mid-task or after a single quick task unless rate-limited. Never stop because `last_research` is today — always attempt research when the queue is low. Within a session's 3-task batch, drive all work forward until genuinely blocked.

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
