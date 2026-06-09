import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Vertical slice — canonical questions over real MCP stdio transport.
//
// Requires an already-synced slice environment (scripts/slice-demo.sh sets
// one up): SLICE_WORKSPACE_ID and IRIS_API_KEY must point at a workspace
// whose HubSpot fixture entities are indexed, with Postgres/Redis running.
// Skipped otherwise — scripts/slice-demo.sh remains the source of truth.
// ---------------------------------------------------------------------------

test.describe('Slice canonical questions (MCP)', () => {
  test('all 5 canonical questions return the expected fixture facts', async () => {
    test.skip(
      !process.env['SLICE_WORKSPACE_ID'] || !process.env['IRIS_API_KEY'],
      'SLICE_WORKSPACE_ID and IRIS_API_KEY not set — run scripts/slice-demo.sh',
    );
    test.setTimeout(180_000);

    const result = spawnSync('npx', ['tsx', 'src/slice-query-client.ts'], {
      cwd: join(ROOT, 'apps', 'mcp-server'),
      env: { ...process.env, EMBEDDING_PROVIDER: 'hash-deterministic' },
      encoding: 'utf8',
      timeout: 150_000,
    });

    console.log(result.stdout);
    if (result.status !== 0) console.error(result.stderr);

    expect(result.status, 'slice-query-client must exit 0 (all questions PASS)').toBe(0);
    expect(result.stdout).toContain('all 5 canonical questions PASS');
  });
});
