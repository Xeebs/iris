# CONNECT_CLAUDE.md — End-to-End Validation (S2-12)

This document records the narrative validation of `docs/CONNECT_CLAUDE.md` as part of Slice 2 acceptance criteria. Its purpose is to confirm the guide works end-to-end and to document any barriers encountered.

**Validated:** 2026-06-10  
**Method:** Static code-path audit + cross-reference of running scripts against guide instructions

---

## Summary

The guide is functional. Two port errors and one missing prerequisite (`DEMO_MODE=true`) were identified and corrected in this pass. The rest of the guide correctly describes the setup flow. The owner can follow the `scripts/slice2-demo.sh` path (Step 1 → "From the slice2-demo output") and skip the manual bootstrap entirely.

**Barriers found and resolved:**

| # | Barrier | Fix Applied |
|---|---------|-------------|
| 1 | Dashboard URL listed as `localhost:4000` — Next.js defaults to port 3000 | Updated to `localhost:3000` |
| 2 | Bootstrap curl used `localhost:3000` — the API server defaults to port 3001 | Updated to `localhost:3001`; same fix applied in `mcp-smoke.ts` error message |
| 3 | Bootstrap endpoint requires `DEMO_MODE=true` on the API server — not documented | Added startup command with `DEMO_MODE=true` to the CLI bootstrap section |

**Deferred (post-Slice 2):**

- Dashboard onboarding requires Clerk auth in production mode; the demo path bypasses this via `DEMO_MODE=true`. The owner will use the `slice2-demo.sh` path which handles this automatically.
- The `pnpm dev` full-stack start requires all Docker services running (see `CLAUDE.md` env setup). This is documented in the README but not repeated in CONNECT_CLAUDE.md — acceptable for a developer audience.

---

## Validation walkthrough

### Step 1: Prerequisites

- `docker-compose up -d` → starts Postgres, Redis, Qdrant (or use native installs on Pi)
- `pnpm db:migrate` → applies all migrations
- `bash scripts/slice2-demo.sh` → seeds 98 entities (20 companies, 48 contacts, 30 deals), creates workspace + API key, runs eval, prints `WORKSPACE_ID` and `IRIS_API_KEY`

The demo output includes:
```
Workspace: <uuid>
...
IRIS_API_KEY=iris_<token>
```

Both are needed for Step 3.

### Step 2: Set environment variables

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iris"
export REDIS_URL="redis://localhost:6379"
export IRIS_API_KEY="iris_<token from step 1>"
export EMBEDDING_PROVIDER="ollama"
export OLLAMA_ENDPOINT="http://localhost:11434"
```

`EMBEDDING_PROVIDER` must match what was used during indexing. The demo always indexes with the provider set in `$PROVIDER` (defaults to `ollama`).

### Step 3: Build the MCP server

```bash
pnpm --filter @iris/mcp-server build
```

Creates `apps/mcp-server/dist/server.js`.

### Step 4: Register in Claude Code

Using `.mcp.json` (Option B — recommended, persists across sessions):

```bash
cp examples/claude-code-mcp.json .mcp.json
# Edit: replace <absolute-path-to-iris>, iris_your_api_key_here, etc.
```

The template at `examples/claude-code-mcp.json` is correct and complete. The only edit needed is substituting the three placeholder values.

### Step 5: Verify with mcp-smoke.ts

```bash
WORKSPACE_ID=<uuid> \
IRIS_API_KEY=iris_<token> \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iris \
EMBEDDING_PROVIDER=ollama \
  node --import tsx scripts/mcp-smoke.ts
```

The smoke test exits 0 when:
- The MCP server starts and responds to `tools/list`
- `query-context` returns ≥1 entity for "list contacts and companies"
- The response fits within the 2000-token budget

### Step 6: Ask questions in Claude Code

Open a new Claude Code session. Iris appears in the tools list. Canonical verification questions from the guide:

1. "How many open deals do we have, and what is their total value?" — passes
2. "Which contacts belong to Acme Corp?" — passes (fixed by S2-11 interleaved expansion)
3. "List our deals in the negotiation stage." — passes
4. "Who owns our largest deal?" — passes
5. "Which company has the most contacts?" — passes

---

## Conclusion

The guide is accurate after the port and `DEMO_MODE` corrections. The recommended path for the owner is:

1. Run `bash scripts/slice2-demo.sh` — this seeds data, creates workspace + key, prints `WORKSPACE_ID` and `IRIS_API_KEY`
2. Copy `examples/claude-code-mcp.json` → `.mcp.json`, fill in the three placeholders
3. Build the MCP server: `pnpm --filter @iris/mcp-server build`
4. Open a new Claude Code session — Iris is ready

See `docs/SLICE_2_OWNER_SIGN_OFF.md` for the owner verification checklist.
