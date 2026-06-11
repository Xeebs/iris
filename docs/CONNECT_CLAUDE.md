# Connecting Iris to Claude Code

This guide walks through registering Iris as an MCP server in Claude Code so you can query your business data directly from the assistant.

## Prerequisites

1. **Iris is running locally**
   - PostgreSQL (with pgvector) and Redis are running
   - The Iris database has migrations applied: `pnpm db:migrate`
   - At least one connector has synced data (use the dashboard onboarding flow, or run `bash scripts/slice2-demo.sh` to get the seeded demo dataset)

2. **The MCP server is built**
   ```bash
   pnpm --filter @iris/mcp-server build
   ```

3. **You have an MCP API key** — see Step 1 below

## Step 1: Get your API key

### From the dashboard

1. Start the API and dashboard: `pnpm dev`
2. Open the Iris dashboard at `http://localhost:3000`
3. Navigate to **Settings → API Keys**
4. Click **Create key**, select your workspace, and copy the key — it starts with `iris_`

### From the demo bootstrap (CLI)

If you have not set up a workspace yet, bootstrap one in one command. The API must be running with `DEMO_MODE=true`:

```bash
# Start the API in demo mode (separate terminal)
DEMO_MODE=true DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iris \
  pnpm --filter @iris/api dev &

# Bootstrap a workspace and API key
curl -X POST http://localhost:3001/api/v1/demo/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"name": "My Workspace"}'
```

The response contains `data.workspaceId` and `data.apiKey`. Save both.

### From the slice2-demo output

If you ran `bash scripts/slice2-demo.sh`, the workspace ID is printed during the bootstrap step and the API key is printed at the end. Copy both from the output — you do not need to call the bootstrap endpoint separately.

## Step 2: Set environment variables

Iris reads its config from environment variables. Export these before starting Claude Code (add them to your shell profile to persist):

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iris"
export REDIS_URL="redis://localhost:6379"
export IRIS_API_KEY="iris_your_key_here"
```

Then add the embedding provider block that matches how the data was indexed. **Pick exactly one:**

```bash
# Option A — Ollama (nomic-embed-text, 768-dim, runs locally on the Pi)
export EMBEDDING_PROVIDER="ollama"
export OLLAMA_ENDPOINT="http://localhost:11434"

# Option B — OpenAI (text-embedding-3-small, 1536-dim)
export EMBEDDING_PROVIDER="openai"
export OPENAI_API_KEY="sk-..."

# Option C — Azure OpenAI (text-embedding-3-small, 1536-dim)
#             This is the default for the Iris Pi setup — check .env.local to confirm.
export EMBEDDING_PROVIDER="azure"
export AZURE_OPENAI_ENDPOINT="https://your-resource.cognitiveservices.azure.com/"
export AZURE_OPENAI_API_KEY="your-azure-api-key"
export AZURE_OPENAI_API_VERSION="2023-05-15"
export AZURE_OPENAI_SMALL_DEPLOYMENT="text-embedding-3-small"
```

**How to check which provider indexed the current data:**

```bash
# Fastest: read the last eval run
python3 -c "import json; d=json.load(open('pipeline/slice2-eval-summary.json')); print('Provider:', d['embeddingProvider'])"

# Or read the environment directly
grep EMBEDDING_PROVIDER .env.local
```

**Important:** `EMBEDDING_PROVIDER` must match the provider used when the data was indexed. Mixing providers (e.g., indexing with `azure`/1536-dim then querying with `ollama`/768-dim) produces meaningless similarity scores and empty results.

## Step 3: Register Iris in Claude Code

### Option A: CLI command

```bash
claude mcp add iris \
  --transport stdio \
  -- node /absolute/path/to/iris/apps/mcp-server/dist/server.js
```

Replace `/absolute/path/to/iris` with the actual path to this repository on your machine.

Claude Code passes the env vars set in Step 2 automatically when it spawns the server.

### Option B: `.mcp.json` config file

Copy the template and fill in your values:

```bash
cp examples/claude-code-mcp.json .mcp.json
```

Then edit `.mcp.json` and replace:
- `<absolute-path-to-iris>` → the actual path to this repo (e.g., `/home/you/iris`)
- `iris_your_api_key_here` → your API key from Step 1
- Adjust `DATABASE_URL`, `EMBEDDING_PROVIDER`, etc. to match your setup

For Azure embeddings (the default Pi setup), use `examples/claude-code-mcp-azure.json` instead:

```bash
cp examples/claude-code-mcp-azure.json .mcp.json
```

Place `.mcp.json` in your project directory (Claude Code picks it up automatically) or in `~/.claude/mcp.json` for global registration.

## Step 4: Verify the connection

Open a new Claude Code session. The Iris MCP server will appear in the tool list. Test with these canonical questions against the seeded demo data:

1. "How many open deals do we have, and what is their total value?"
2. "Which contacts belong to Acme Corp?"
3. "List our deals in the negotiation stage."
4. "Who owns our largest deal?"
5. "Which company has the most contacts?"

Or verify programmatically before opening Claude Code:

```bash
# Source your environment first so the embedding provider vars are available:
source .env.local   # or export each var from Step 2 manually

SLICE_WORKSPACE_ID=<your-workspace-id> \
IRIS_API_KEY=<your-api-key> \
  node --import tsx scripts/mcp-smoke.ts
```

The smoke test connects to the MCP server over stdio (the same transport Claude Code uses), lists tools, calls `query-context`, and exits 0 on success. It inherits `EMBEDDING_PROVIDER` and provider-specific vars from the environment.

## Environment variable reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string for the Iris database |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL |
| `IRIS_API_KEY` | Recommended | — | MCP API key scoped to your workspace. Omit to run in unauthenticated dev mode (all workspaces accessible — only for local development) |
| `EMBEDDING_PROVIDER` | Yes | `ollama` | `ollama` (768-dim), `openai` (1536-dim), or `azure` / `azure-openai` (1536-dim) |
| `OLLAMA_ENDPOINT` | No | `http://localhost:11434` | Ollama base URL (required when `EMBEDDING_PROVIDER=ollama`) |
| `OPENAI_API_KEY` | If openai | — | Required when `EMBEDDING_PROVIDER=openai` |
| `AZURE_OPENAI_ENDPOINT` | If azure | — | Azure OpenAI resource URL (e.g., `https://your-resource.cognitiveservices.azure.com/`) |
| `AZURE_OPENAI_API_KEY` | If azure | — | Azure OpenAI API key |
| `AZURE_OPENAI_API_VERSION` | No | `2023-05-15` | Azure OpenAI API version |
| `AZURE_OPENAI_SMALL_DEPLOYMENT` | No | `text-embedding-3-small` | Deployment name for the small embedding model |
| `AZURE_OPENAI_LARGE_DEPLOYMENT` | No | `text-embedding-3-large` | Deployment name for the large embedding model |

## Available MCP tools

| Tool | Description |
|------|-------------|
| `query-context` | Semantic search across all indexed business entities. The primary tool for business questions. |
| `list-entities` | List entities by type (`contact`, `company`, `deal`, etc.) with optional filters |
| `get-entity` | Fetch a specific entity by ID with full attributes |
| `get-metric` | Retrieve a named business metric (e.g., monthly revenue) |
| `list-glossary` | Return the workspace business glossary |
| `aggregate-entities` | Aggregate entity fields (count, sum, avg, max, min) |
| `compare-entities` | Compare two or more entities side by side |
| `detect-anomalies` | Detect statistical anomalies in entity attributes |
| `advanced-query-context` | Multi-step retrieval with re-ranking |

All tools respect the `contextBudget` parameter (default: 2000 tokens) and never return raw records.

## Troubleshooting

**"Server failed to start"**
- Confirm `DATABASE_URL` is correct and the database is accessible: `psql $DATABASE_URL -c '\l'`
- Verify the MCP server is built: `pnpm --filter @iris/mcp-server build`
- Check migrations: `pnpm db:migrate`

**"Invalid IRIS_API_KEY"**
- The key is scoped to a workspace; make sure you are using the key for the workspace that contains your indexed data
- Keys start with `iris_` — confirm the value is complete (not truncated)

**Empty query results**
- Confirm a sync has completed: check the Sync tab in the dashboard or run `psql $DATABASE_URL -c "SELECT COUNT(*) FROM iris_entities WHERE workspace_id = '<id>'"` 
- Verify `EMBEDDING_PROVIDER` matches what was used at index time

**Embedding provider mismatch**
- Provider dimensions: `ollama` (nomic-embed-text) → 768-dim; `openai` → 1536-dim; `azure` → 1536-dim
- If you indexed with one provider and query with another, similarities are meaningless and results will be empty or wrong
- The Pi demo data was indexed with `azure` (1536-dim) — verify with `grep EMBEDDING_PROVIDER .env.local` or `python3 -c "import json; d=json.load(open('pipeline/slice2-eval-summary.json')); print(d['embeddingProvider'])"`
- Fix: set `EMBEDDING_PROVIDER` to the same value used at index time, or re-index from scratch: `psql $DATABASE_URL -c "TRUNCATE iris_entities"` then re-run `scripts/slice2-demo.sh`

**High latency**
- Ollama embeddings on CPU (e.g., Raspberry Pi) are slower than GPU — the server is functional but query latency will be higher
- Query latency p50/p95 is printed in the slice2-demo token report

---

## Owner verification

Once connected and answering questions correctly, see `docs/SLICE_2_OWNER_SIGN_OFF.md` for the five canonical verification questions and the final sign-off steps to mark Slice 2 ACHIEVED.
