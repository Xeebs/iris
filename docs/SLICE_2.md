# Slice 2 — Iris in Real Use

**Status: NOT ACHIEVED**

## Why this document exists

Slice 1 (`docs/VERTICAL_SLICE.md`, ACHIEVED 2026-06-10) proved the *plumbing*: connect → sync → index → serve → query → measure works from a clean database. But it proved it against hand-built HubSpot fixtures, with the `hash-deterministic` embedding provider, queried by a script. None of that is the product. Retrieval quality has never been measured with real semantic vectors, no real data source has ever flowed through the system, and no real MCP client has ever connected.

Slice 2 redirects all pipeline effort to a single goal:

> **The project owner connects a real data source, registers Iris as an MCP server in their own Claude Code, asks real business questions, and gets correct answers — with real embeddings, measured for accuracy and token cost.**

Until this works, no new features may be built. Every pipeline cycle must either advance this slice, finish the in-flight Layer 77 route-mounting sweep, or fix something that blocks one of those.

## The slice, precisely

The same unbroken chain as Slice 1, with every fake link made real:

| Link | Slice 1 (proven) | Slice 2 (required) |
|------|------------------|--------------------|
| Data source | Hand-built HubSpot fixtures | **Postgres connector against a live local database** seeded with a realistic business dataset (`scripts/seed-business-db.sql`). GitHub connector as a stretch goal if a valid token is available. |
| Embeddings | `hash-deterministic` | **A real embedding provider**: `EMBEDDING_PROVIDER=ollama` (nomic-embed-text, local on the Pi) or `openai` (text-embedding-3-small) if a key is configured. Never hash-deterministic. |
| Client | Scripted MCP calls | **The owner's own Claude Code session**, with Iris registered via `.mcp.json` / `claude mcp add`. A scripted SDK client remains for CI. |
| Quality bar | 5 canonical questions | **An eval harness of ≥20 questions** with expected facts, scored for accuracy and token cost. |
| Setup path | curl against the REST API | **The dashboard onboarding golden path**: create connector → watch sync → copy MCP config snippet, via UI. |

## Acceptance criteria

Script-verifiable (all enforced by `scripts/slice2-demo.sh`, single command, exit 0 = pass):

- [x] `scripts/slice2-demo.sh` runs the full chain from a **fresh database** with a **real embedding provider** (the script must refuse to run with `EMBEDDING_PROVIDER=hash-deterministic`) and a **real connector source** (live local Postgres seeded by the script — not static fixture JSON)
- [x] The eval harness (`apps/mcp-server/src/eval-retrieval.ts`) runs ≥20 questions against the indexed data; **≥90% of answers contain the expected facts**, every response within `contextBudget` *(pipeline-verified: 22/22 = 100%, cycle 622)*
- [x] The demo prints a token report (Iris response tokens vs. raw-data-paste baseline per question); **total savings ≥ 70%** *(pipeline-verified: 79.2%, cycle 622)*
- [x] The demo passes **twice in a row** from clean state *(pipeline-verified, cycle 622)*
- [x] A `slice2-demo` CI job runs the demo (Ollama + nomic-embed-text installed and cached in the runner) and is green *(CI GREEN, daemon-confirmed)*
- [x] The dashboard onboarding golden path works end to end and is covered by a Playwright test (`tests/e2e/onboarding-golden-path.spec.ts`) that is green in CI *(CI GREEN, daemon-confirmed)*

Owner-verified (NOT waivable this time — green CI does not substitute):

- [ ] The owner has registered Iris in their own Claude Code via the documented steps (`docs/CONNECT_CLAUDE.md`), asked real questions against the seeded data in a live session, and confirmed correct answers. The owner flips this checkbox and the status line personally.

## Known real-world issues this slice must confront

These are exactly the kinds of problems Slice 1's fakes hid — hitting them is the point:

1. **Embedding dimensionality.** The pgvector schema assumes 1536-dim (`vector(1536)`); nomic-embed-text produces 768-dim vectors. The vector column/index dimension must follow the configured provider, and a provider/dimension mismatch at startup must be a hard, clear error — silent truncation or padding is forbidden (see `.claude/rules/embedding-patterns.md`: one model across the entire system; model change ⇒ full re-index).
2. **Retrieval quality with real vectors.** Cosine thresholds (0.85 dedup / 0.92 cache / 0.70 related) were tuned on nothing. The eval harness exists to measure them; adjust only with eval evidence.
3. **Latency.** Real embeddings on the Pi are not instant. The demo must report indexing throughput (entities/sec) and query latency (p50/p95) so regressions are visible. No hard threshold for the slice — measure first.
4. **Question 4 from Slice 1 only saved 33%** — superlative/aggregate questions ("largest deal") stress retrieval. The eval set must include at least 4 aggregate/superlative questions.

## What is explicitly OUT of scope until Slice 2 is achieved

- New connectors, new MCP tools, new dashboard pages beyond the onboarding golden path
- Enterprise features of any kind (SLO/HA/tracing/governance/compliance/analytics/recommendations)
- Layer 74/76 queue tasks (event-driven sync, query recommendation ML, coverage padding) — frozen
- Exception: the Layer 77 route-mounting sweep is mid-flight and may be finished (it repairs an existing product gap), but it never takes priority over an UNWORKED Layer 79 task

## After the slice

When the status line reads ACHIEVED, the next planned phase is **prune and consolidate**: with real usage data in hand, audit the ~1,400-file surface area (dashboard panels, mounted-but-unused routes, speculative subsystems) and cut what serves no real flow. Every post-slice feature task must state which user-visible flow it serves.
