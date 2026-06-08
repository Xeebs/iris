# Troubleshooting Guide

Common issues encountered when self-hosting Iris, and how to resolve them.

---

## Database

### `FATAL: password authentication failed for user "postgres"`

**Cause:** `POSTGRES_PASSWORD` in `.env.local` doesn't match what Postgres was initialized with.

**Fix:**
```bash
# If first run, delete the volume and restart with correct password
docker compose -f infra/docker/docker-compose-full.yml down -v
# Edit .env.local with the correct POSTGRES_PASSWORD
docker compose -f infra/docker/docker-compose-full.yml up -d
```

### Migrations fail: `relation "xxx" already exists`

**Cause:** Migrations were run twice, or a previous failed run left partial state.

**Fix:** Check the `schema_migrations` table:
```sql
SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 10;
```
If the migration is already recorded, it's safe to ignore. If partially applied, manually revert and re-run.

### pgvector extension not available

**Cause:** Using a plain Postgres image instead of `pgvector/pgvector:pg16`.

**Fix:** Ensure `docker-compose.yml` uses `pgvector/pgvector:pg16`, not `postgres:16`.

### Slow queries on entity search

**Cause:** Missing vector index or too many entities for the current `ivfflat` lists count.

**Fix:**
```sql
-- Check index exists
SELECT indexname FROM pg_indexes WHERE tablename = 'entities';

-- Rebuild index with correct lists parameter (sqrt of row count)
SELECT COUNT(*) FROM entities;  -- e.g., 100000 rows → 316 lists
DROP INDEX IF EXISTS entities_embedding_idx;
CREATE INDEX entities_embedding_idx ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 316);
```

---

## Redis

### `ECONNREFUSED` connecting to Redis

**Cause:** Redis container is not running, or `REDIS_URL` is misconfigured.

**Fix:**
```bash
# Verify Redis is running
docker compose ps redis

# Test connectivity
docker compose exec redis redis-cli ping
# Expected: PONG

# Check REDIS_URL in .env.local
grep REDIS_URL .env.local
```

### Rate limiter not working (all requests pass through)

**Cause:** Redis is not connected; the API falls back to no rate limiting.

**Fix:** Ensure `REDIS_URL` is set and Redis is reachable from the API container.

---

## Qdrant

### `Connection refused` to Qdrant

**Cause:** Qdrant container is not running or `QDRANT_URL` is wrong.

**Fix:**
```bash
docker compose ps qdrant

# Test API
curl http://localhost:6333/healthz

# Verify URL in .env.local
grep QDRANT_URL .env.local
# Should be: QDRANT_URL=http://qdrant:6333 (inside Docker) or http://localhost:6333 (host)
```

### Qdrant collection not found

**Cause:** Collection was not created during initialization.

**Fix:** Run the vector store initialization:
```bash
docker compose exec api node -e "
const { PgvectorStore } = require('./dist/packages/semantic-core');
const store = new PgvectorStore(process.env.DATABASE_URL);
store.initialize().then(() => console.log('done'));
"
```

---

## Connector Issues

### OAuth connector: `Token expired` on sync

**Cause:** OAuth tokens were not refreshed before expiry.

**Fix:** Revoke and re-authorize the connector:
1. Go to **Connectors → [connector name] → Settings**
2. Click **Re-authorize**
3. Complete OAuth flow
4. Trigger a full re-sync

### Sync stuck at 0 entities

**Cause:** Connector API rate limit hit, or network connectivity issue.

**Fix:**
```bash
# Check connector logs
docker compose logs api | grep "connectorId=<id>"

# Force a re-sync via API
curl -X POST http://localhost:3001/api/v1/connectors/<id>/sync \
  -H "Authorization: Bearer <token>"
```

### `ConnectorError: retryable=false` in logs

**Cause:** Connector received a permanent error (e.g., invalid credentials, API key revoked).

**Fix:** Re-configure the connector with updated credentials.

---

## MCP Server

### Claude cannot connect to MCP server

**Cause:** MCP server is not running, or the API key in Claude Desktop config is wrong.

**Fix:**
```bash
# Verify MCP server is running
curl http://localhost:3002/health

# Check Claude Desktop config (~/.config/claude/config.json or similar)
# Ensure the URL and api_key match what's in your .env.local
```

### MCP responses are empty / no entities returned

**Cause:** No entities indexed, or the workspace ID in the API key doesn't match.

**Fix:**
1. Verify entities exist: `GET /api/v1/entities?workspaceId=<id>&limit=5`
2. Check that the MCP API key is scoped to the correct workspace
3. Trigger a connector sync and wait for it to complete

---

## DNS / Networking

### Services cannot resolve each other (Docker Compose)

**Cause:** Containers are on different networks.

**Fix:** Ensure all services in `docker-compose-full.yml` are on the same default network. Do not use custom networks unless you've verified connectivity.

### Kubernetes pods cannot reach Postgres

**Cause:** Network policy blocking traffic, or wrong service name in `DATABASE_URL`.

**Fix:**
```bash
# Inside a pod, test connectivity
kubectl exec -it deploy/iris-api -n iris -- curl postgres:5432

# Check service exists
kubectl get svc postgres -n iris
```

`DATABASE_URL` should use the Kubernetes service name: `postgres://postgres:password@postgres:5432/iris`

---

## Performance

### High memory usage on API containers

**Cause:** Large entity syncs buffering everything in memory.

**Fix:** Ensure connectors use async generators (streaming sync) — check that `sync()` yields entities rather than collecting them all in an array.

Increase container memory limits temporarily if migrating large datasets:
```yaml
# values.yaml
resources:
  limits:
    memory: 2Gi
```

### Slow MCP response times (> 2s)

**Cause:** Embedding generation is happening at query time, or Qdrant index is warm-up.

**Fix:**
1. Ensure embeddings are pre-generated at index time, not query time.
2. Warm up Qdrant by running a few test queries after startup.
3. Enable the semantic cache: check `REDIS_URL` is configured.

---

## Getting Help

1. Check the logs: `docker compose logs -f [service]`
2. Open the Jaeger UI at `http://localhost:16686` and search for failed traces
3. Check the admin dashboard: `http://localhost:3000/admin/system-health`
4. File an issue: https://github.com/xeebs/iris/issues
