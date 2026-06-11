# Slice 2 — Owner Sign-Off Checklist

This document is for the owner to complete the final, non-waivable acceptance criterion of Slice 2:

> "The owner has registered Iris in their own Claude Code via the documented steps, asked real questions against the seeded data in a live session, and confirmed correct answers. The owner flips this checkbox and the status line personally."

CI cannot substitute for this step. Complete the checklist below, then flip the status line in `docs/SLICE_2.md` from `NOT ACHIEVED` to `ACHIEVED`.

---

## Pre-flight

- [ ] You are on a machine with the Iris repo checked out and `pnpm install` run
- [ ] PostgreSQL (with pgvector extension) is running and accessible at `$DATABASE_URL`
- [ ] Redis is running (default: `redis://localhost:6379`)
- [ ] Embedding provider is configured. Check which one is active:
  ```bash
  grep EMBEDDING_PROVIDER .env.local
  # or: python3 -c "import json; d=json.load(open('pipeline/slice2-eval-summary.json')); print('Provider:', d['embeddingProvider'])"
  ```
  - **Azure** (default on the Pi — `EMBEDDING_PROVIDER=azure`): confirm `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` are set in `.env.local`
  - **Ollama** (`EMBEDDING_PROVIDER=ollama`): confirm Ollama is running: `ollama list | grep nomic-embed-text` (pull if missing: `ollama pull nomic-embed-text`)
- [ ] The MCP server is built: `pnpm --filter @iris/mcp-server build`
  - Produces `apps/mcp-server/dist/server.js`

---

## Step 1 — Bootstrap + seed data

Run the demo script. It creates a fresh Iris database, seeds 98 business entities (20 companies, 48 contacts, 30 deals), and prints the workspace ID and API key you need in Step 3.

```bash
bash scripts/slice2-demo.sh
```

Expected output near the end:
```
Workspace: <uuid>
...
✓ Eval: XX/22 (≥90%)
✓ Token savings: XX% (≥70%)
...
IRIS_API_KEY=iris_<token>
```

Save both `Workspace` (the UUID) and `IRIS_API_KEY`.

- [ ] Demo exits 0
- [ ] Eval accuracy is ≥ 90%
- [ ] Token savings ≥ 70%

---

## Step 2 — Configure `.mcp.json`

Copy the template that matches your embedding provider:

```bash
# Azure (default on the Pi — most likely what you need):
cp examples/claude-code-mcp-azure.json .mcp.json

# Ollama:
cp examples/claude-code-mcp.json .mcp.json
```

Edit `.mcp.json` — replace all placeholders. For **Azure**:

```json
{
  "mcpServers": {
    "iris": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/iris/apps/mcp-server/dist/server.js"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/iris",
        "REDIS_URL": "redis://localhost:6379",
        "IRIS_API_KEY": "iris_YOUR_KEY_FROM_STEP_1",
        "EMBEDDING_PROVIDER": "azure",
        "AZURE_OPENAI_ENDPOINT": "https://your-resource.cognitiveservices.azure.com/",
        "AZURE_OPENAI_API_KEY": "your-azure-api-key",
        "AZURE_OPENAI_API_VERSION": "2023-05-15",
        "AZURE_OPENAI_SMALL_DEPLOYMENT": "text-embedding-3-small"
      }
    }
  }
}
```

Copy the actual Azure values from `.env.local` — they are already set there.

- [ ] `/ABSOLUTE/PATH/TO/iris` replaced with real path (e.g. `/home/xhasan/my-projects/Iris`)
- [ ] `IRIS_API_KEY` replaced with the key from Step 1
- [ ] Azure values (or Ollama endpoint) filled in to match what was used at index time
- [ ] `.mcp.json` is in the Iris repo root (or `~/.claude/mcp.json` for global registration)

---

## Step 3 — Open Claude Code and run the smoke test

Open a new Claude Code session in the Iris project directory. Iris should appear in the available tools list (check with `/tools` or look for `iris:query-context` in the tools panel).

As a quick sanity check before asking questions, run the programmatic smoke test:

```bash
# Source .env.local first so EMBEDDING_PROVIDER and provider credentials are inherited:
source .env.local

SLICE_WORKSPACE_ID=<uuid-from-step-1> \
IRIS_API_KEY=<api-key-from-step-1> \
  node --import tsx scripts/mcp-smoke.ts
```

- [ ] Smoke test exits 0
- [ ] Claude Code session shows `iris:query-context` (or similar) in tools

---

## Step 4 — Ask the verification questions

In the Claude Code session, ask each of these 5 questions (or their natural equivalents). The answer should contain the expected facts.

| # | Question | Expected in response |
|---|----------|---------------------|
| 1 | "Who are the contacts at Acme Corp?" | Alice Johnson, Marcus Webb, Diana Patel |
| 2 | "List all our open deals and their total pipeline value." | Globex Enterprise Platform, Quantum Security Platform, multiple deals |
| 3 | "Which companies have more than 200 employees?" | Globex, BlueSky, Quantum Systems, Forge Manufacturing, Pacific Logistics, Ember Energy |
| 4 | "Who is the owner of our largest deal?" | Sarah Kim (or the deal name: Globex Enterprise Platform) |
| 5 | "Which contact is a CTO or VP of Engineering?" | Marcus Webb (CTO, Acme Corp) or others with matching title |

- [ ] Q1 passes — at least Alice Johnson, Marcus Webb, Diana Patel appear
- [ ] Q2 passes — multiple deals shown with amounts
- [ ] Q3 passes — at least 3 companies with >200 employees shown
- [ ] Q4 passes — Globex Enterprise Platform identified as largest deal
- [ ] Q5 passes — at least one CTO/VP Engineering contact returned

---

## Step 5 — Sign off

If all checkboxes above are checked:

1. Open `docs/SLICE_2.md`
2. Change line 3 from:
   ```
   **Status: NOT ACHIEVED**
   ```
   to:
   ```
   **Status: ACHIEVED**
   ```
3. Tick the final acceptance criterion checkbox on line 40 of `docs/SLICE_2.md`
4. Commit: `git commit -m "feat(slice2): ACHIEVED — owner verified real MCP session"`

The pipeline will detect the status flip and enter post-slice mode.

---

## Troubleshooting

**Iris doesn't appear in Claude Code tools**
- Confirm `.mcp.json` is in the project root or `~/.claude/mcp.json`
- Restart Claude Code after adding the config
- Verify `apps/mcp-server/dist/server.js` exists (re-run `pnpm --filter @iris/mcp-server build`)

**"IRIS_API_KEY: invalid" error**
- The key is scoped to the workspace created in Step 1 — confirm you used the key that was printed by `slice2-demo.sh`
- If you re-ran the demo, get the new key from that run's output

**Empty results / wrong answers**
- Confirm `EMBEDDING_PROVIDER` in `.mcp.json` matches what was used during indexing.
  Check: `python3 -c "import json; d=json.load(open('pipeline/slice2-eval-summary.json')); print(d['embeddingProvider'])"`
  The Pi default is `azure` (1536-dim). Using `ollama` (768-dim) against azure-indexed data produces meaningless similarity scores and empty results.
- If using Ollama: verify it is running: `curl -sf http://localhost:11434/api/tags`
- If using Azure: verify the Azure endpoint and API key in `.mcp.json` match `.env.local`
- Confirm the `IRIS_API_KEY` in `.mcp.json` is the key printed by `slice2-demo.sh` (starts with `iris_`). The workspace ID is derived from the API key — no need to edit it separately.

**Accuracy below expectations for Q3 / Q12**
- Questions about aggregate counts (companies with >200 employees) or superlatives (second largest deal) are harder for semantic search — see `docs/SLICE_2.md` known issues. Q1, Q2, Q4, Q5 should pass reliably; Q3 may require rephrasing.
