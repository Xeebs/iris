# VS-2 Demo-mode HubSpot sync — test result

- `pnpm --filter @iris/connector-hubspot typecheck` — PASS
- `vitest run` (full package) — PASS (37/37)

Notes:
- demoMode flag added to connector + manifest config schemas; connect() skips
  OAuth and get() serves tests/fixtures/*.json (works from src and dist —
  both one level under the package root).
- Fixtures expanded for the canonical questions: 3 open deals totaling 195000;
  negotiation deals = Acme Annual Contract + Globex Pilot Expansion; largest
  deal = Acme Annual Contract (owner 50); Acme Corp contacts = Alice Smith +
  Carol White. demo-mode.test.ts asserts each fact and that no fetch occurs.
- Fixed broken package entry: main pointed at dist/index.js which never
  existed (no src/index.ts); now points at dist/hubspot-connector.js.
- Fixed pre-existing test failure: assertEntityShape must be imported from
  @iris/connector-sdk/test-utils (subpath), not the package root.
- REMAINING GAP for VS-3: nothing registers the HubSpot connector in the
  connector-sdk registry, and createSyncWorker is only started with
  SYNC_WORKER_STANDALONE=true — the demo script must register + start both.
