# VS-5 Token-savings measurement — test result

PASS (2026-06-09)

## What was verified
- `pnpm --filter @iris/semantic-core build` → exit 0; emits `dist/llm-router.{js,d.ts}` with `estimateTokens` (new `./llm-router` subpath export).
- `pnpm --filter @iris/connector-hubspot build` → exit 0 (derived open/closed `status` attribute on deals typechecks).
- `pnpm --filter @iris/connector-hubspot test` → 37/37 pass, 96% coverage. Updated count assertions in `demo-mode.test.ts` and `hubspot-connector.test.ts` to match the expanded fixtures (8 contacts / 4 companies / 10 deals = 22 entities). Canonical-fact assertions (3 open deals = $195k, negotiation = Acme+Globex, largest = Acme Annual owner 50, Alice→Acme, Acme contacts = Alice+Carol) all still hold.
- `slice-query-client.ts` type-checked clean (bundler resolution, which honors the package exports map exactly as tsx/Node runtime do) → exit 0.

## Not verifiable in this environment
- Live end-to-end `scripts/slice-demo.sh` (needs Postgres/pgvector, Redis, Qdrant via docker-compose, not running on this host). The measure phase is wired into the demo (step 8/8 → `slice-query-client.ts`), writes `pipeline/slice-report.md`, prints a per-question table, and enforces the ≥70% savings gate at runtime. Actual savings numbers are produced when the demo runs against infra — covered by VS-6 (CI slice-demo job + double-run + human verification).

## Baselines (raw-paste token estimates, length/4)
- deals.json: 932 tokens (Q1/Q3/Q4 baseline)
- contacts.json + companies.json: 1259 tokens (Q2/Q5 baseline)
The fixture expansion adds realistic irrelevant volume a user would paste; Iris returns only the relevant entities — this is the value demonstration, not baseline-gaming (canonical answers are unchanged).
