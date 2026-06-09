# VS-4 MCP query verification — test result

- `pnpm --filter @iris/semantic-core typecheck` — PASS
- semantic-core retrieval tests — PASS (27/27)
- slice-query-client smoke test (parse + SDK import + env guard) — PASS

Slice-path fix bundled: retrieval.ts embedQuery() was hard-wired to Azure
OpenAI — query vectors could never match hash-indexed vectors. It now honors
an explicit EMBEDDING_PROVIDER env (same rule as generateEmbeddings).

KNOWN LOCAL LIMITATION (pre-existing, not caused by this change):
`tsc --noEmit` for apps/mcp-server OOMs on this machine even at 6GB heap and
even without the new file — CI is the typecheck authority for that package.

NOT VERIFIED LIVE: no Postgres/Redis/Docker on this machine; the query phase
runs for real when CI gets the slice-demo job (VS-6) or the owner runs
scripts/slice-demo.sh locally.
