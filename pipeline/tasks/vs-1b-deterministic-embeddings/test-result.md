# VS-1b Deterministic embedding provider — test result

- `pnpm --filter @iris/semantic-core typecheck` — PASS
- `vitest run providers/__tests__/deterministic-hash-provider.test.ts __tests__/embedding.test.ts` — PASS (24/24)

Notes: implemented token-level feature hashing (not whole-text hashing) so
token-overlapping queries rank related entities higher — whole-text hashing
would give near-orthogonal vectors and break slice retrieval. Also wired
EMBEDDING_PROVIDER env into generateEmbeddings() so the sync-worker index
path honors hash-deterministic without code changes; legacy Azure path
unchanged when the env var is unset.
