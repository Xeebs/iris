# The Vertical Slice — Iris's Only Milestone Right Now

**Status: NOT ACHIEVED** (update this line to `ACHIEVED <date>` only when every acceptance criterion below has been demonstrated, twice, from a clean database.)

## Why this document exists

After 344 pipeline cycles, Iris has ~1,350 TypeScript files, 14 connectors, and 285 completed tasks — and has never once demonstrated its core value proposition end to end. Features were built and tested in isolation (~80 API route modules were never even mounted). This document redirects all pipeline effort to a single goal:

> **One user connects HubSpot, asks a business question through Iris via MCP, and gets a correct answer that costs measurably fewer tokens than pasting the raw data.**

Until that demo works, reliably, from scratch, **no new features may be built**. Every pipeline cycle must either advance this slice or fix something that blocks it.

## The slice, precisely

One unbroken chain, every link running as a real process against real local infrastructure (Postgres/pgvector, Redis, Qdrant via `infra/docker/docker-compose.yml`):

```
1. CONNECT   A workspace + HubSpot connector instance is created via the REST API
             (connector runs in fixture/sandbox mode — no real HubSpot account needed,
              fixtures: packages/connectors/hubspot/tests/fixtures/)
2. SYNC      The connector sync runs and yields SemanticEntities (contacts, companies, deals)
3. INDEX     The indexer embeds and stores those entities in the vector store
4. SERVE     The MCP server starts, authenticates with a workspace-scoped API key
5. QUERY     A scripted MCP client calls `query-context` with canonical business questions
6. ANSWER    The responses contain the correct facts from the fixture data,
             within the contextBudget
7. MEASURE   Token usage of the Iris response is logged and compared to the
             raw-fixture-paste baseline; the savings ratio is reported
```

## Acceptance criteria

All of these, verified by `scripts/slice-demo.sh` (single command, exit 0 = pass):

- [ ] `scripts/slice-demo.sh` runs the full chain above from a **fresh database** (drops/recreates, runs migrations) with no manual steps
- [ ] All 5 canonical questions (below) return answers containing the expected facts
- [ ] Every response respects `contextBudget` (default 2000 tokens)
- [ ] The demo prints a token report: Iris response tokens vs. raw fixture JSON tokens, per question — savings must be ≥ 70%
- [ ] The demo passes **twice in a row** from clean state (proves no hidden state/ordering luck)
- [ ] The demo runs in CI as a required job (`slice-demo`) and is green
- [ ] A human (the project owner) has run it locally and seen it work

## Canonical questions (fixture-grounded)

These are asserted against known values in the HubSpot fixtures. If fixtures change, update both together.

1. "How many open deals do we have, and what is their total value?"
2. "Which company does <fixture contact name> work for?"
3. "List our deals in the negotiation stage."
4. "Who is the owner of our largest deal?"
5. "Which contacts belong to <fixture company name>?"

## What is explicitly OUT of scope until the slice is achieved

- New connectors, new MCP tools, new dashboard pages, new REST routes (beyond those the slice requires)
- Enterprise features of any kind: SLO/HA/tracing/governance/compliance/analytics/recommendations
- Mounting the remaining orphaned routes (only slice-critical routes get mounted now; the rest resume post-slice)
- Test-coverage padding on code the slice doesn't touch

## After the slice

When the status line at the top reads ACHIEVED, the pipeline returns to `pipeline/queue.md` breadth work — starting with the deprioritized route-mounting sweep — but every future feature task must state how it serves a user-visible flow.
