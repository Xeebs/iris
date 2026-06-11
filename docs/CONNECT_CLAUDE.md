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
export EMBEDDING_PROVIDER="ollama"            # or "openai"
export OLLAMA_ENDPOINT="http://localhost:11434" # if using Ollama
# export OPENAI_API_KEY="sk-..."              # if using EMBEDDING_PROVIDER=openai
```

**Important:** `EMBEDDING_PROVIDER` must match the provider used when the data was indexed. Mixing providers (e.g., indexing with `ollama` then querying with `openai`) produces meaningless similarity scores.

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
SLICE_WORKSPACE_ID=<your-workspace-id> \
IRIS_API_KEY=<your-api-key> \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iris \
EMBEDDING_PROVIDER=ollama \
  node --import tsx scripts/mcp-smoke.ts
```

The smoke test connects to the MCP server over stdio (the same transport Claude Code uses), lists tools, calls `query-context`, and exits 0 on success.

## Environment variable reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string for the Iris database |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL |
| `IRIS_API_KEY` | Recommended | — | MCP API key scoped to your workspace. Omit to run in unauthenticated dev mode (all workspaces accessible — only for local development) |
| `EMBEDDING_PROVIDER` | Yes | `ollama` | `ollama` (nomic-embed-text, 768-dim) or `openai` (text-embedding-3-small, 1536-dim) |
| `OPENAI_API_KEY` | If openai | — | Required when `EMBEDDING_PROVIDER=openai` |
| `OLLAMA_ENDPOINT` | No | `http://localhost:11434` | Ollama base URL |

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
- Ollama (nomic-embed-text) produces 768-dim vectors; OpenAI text-embedding-3-small produces 1536-dim vectors
- If you indexed with one provider and query with another, similarities are meaningless
- Fix: re-index from scratch with the correct provider: drop the `iris_entities` table data and re-trigger sync

**High latency**
- Ollama embeddings on CPU (e.g., Raspberry Pi) are slower than GPU — the server is functional but query latency will be higher
- Query latency p50/p95 is printed in the slice2-demo token report
