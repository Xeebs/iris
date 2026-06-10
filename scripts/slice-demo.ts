/**
 * Vertical slice demo driver (docs/VERTICAL_SLICE.md).
 *
 * From a clean database: reset schema → migrate → start API + sync worker
 * (DEMO_MODE, hash-deterministic embeddings) → bootstrap workspace + API key
 * → create demo-mode HubSpot connector → trigger sync → verify indexed
 * entity counts → query the MCP server (stdio, real client transport) with
 * the 5 canonical questions and assert the expected facts. Fails fast with
 * a clear message at the first broken step; exit 0 means the full
 * connect → sync → index → serve → query → answer chain works.
 *
 * Run via scripts/slice-demo.sh. Requires local Postgres + Redis
 * (infra/docker/docker-compose.yml).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import postgres from 'postgres';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_DIR = join(ROOT, 'apps', 'api');

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const PORT = Number(process.env['SLICE_DEMO_PORT'] ?? 3901);
const BASE = `http://localhost:${PORT}`;

const EXPECTED_ENTITY_COUNT = 22; // 8 contacts + 4 companies + 10 deals (HubSpot fixtures)

const CHILD_ENV = {
  ...process.env,
  DEMO_MODE: 'true',
  EMBEDDING_PROVIDER: 'hash-deterministic',
  DATABASE_URL,
  REDIS_URL,
  PORT: String(PORT),
  SYNC_WORKER_STANDALONE: 'true',
};

const children: ChildProcess[] = [];

function step(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function fail(message: string): never {
  console.error(`\nSLICE DEMO FAILED: ${message}`);
  for (const child of children) child.kill('SIGTERM');
  process.exit(1);
}

function startProcess(name: string, scriptPath: string, cwd: string): ChildProcess {
  // Spawn `node --import tsx` directly (single process) instead of `npx tsx`:
  // npx does NOT forward SIGTERM to its grandchildren, so kill() on the npx
  // wrapper orphans the actual server. In CI the orphan holds the step's
  // inherited output pipe open, hanging the step until timeout-minutes kills
  // it — even when the demo itself already printed PASS/FAIL and exited.
  const child = spawn('node', ['--import', 'tsx', scriptPath], {
    cwd,
    env: CHILD_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[${name}] ${d.toString()}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${name}] ${d.toString()}`));
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`[${name}] exited with code ${code}`);
  });
  children.push(child);
  return child;
}

async function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function waitFor(description: string, timeoutMs: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) break;
      // Cap each probe at 8 s so a hanging fetch/query never blocks the whole waitFor
      if (await withTimeout(Math.min(8_000, timeLeft), probe())) return;
    } catch {
      // keep polling until the deadline
    }
    await sleep(1500);
  }
  fail(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`${init.method ?? 'GET'} ${path} returned ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main(): Promise<void> {
  step('1/8 Reset database (drop + recreate schema)');
  const adminSql = postgres(DATABASE_URL, { max: 1 });
  try {
    await adminSql.unsafe('DROP SCHEMA public CASCADE');
    await adminSql.unsafe('CREATE SCHEMA public');
    await adminSql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (e) {
    fail(`Could not reset database at ${DATABASE_URL} — is docker-compose up? (${e instanceof Error ? e.message : String(e)})`);
  }
  console.log('Database reset.');

  step('2/8 Run migrations');
  await withTimeout(60_000, new Promise<void>((resolve) => {
    const migrate = spawn('node', ['--import', 'tsx', 'src/db/migrate.ts'], { cwd: API_DIR, env: CHILD_ENV, stdio: 'inherit' });
    migrate.on('exit', (code) => {
      if (code !== 0) fail(`Migrations exited with code ${code}`);
      resolve();
    });
  })).catch((e: unknown) => fail(`Migration timed out or crashed: ${e instanceof Error ? e.message : String(e)}`));

  step('3/8 Start API server + sync worker (DEMO_MODE, hash-deterministic embeddings)');
  startProcess('api', 'src/server.ts', API_DIR);
  startProcess('worker', 'src/workers/sync-worker.ts', API_DIR);
  await waitFor('API /health to return ok', 90_000, async () => {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  });
  console.log('API is healthy.');

  step('4/8 Bootstrap workspace + MCP API key');
  const bootstrap = (await api('/api/v1/demo/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Slice Demo Workspace' }),
  })) as { data: { workspaceId: string; apiKey: string } };
  const { workspaceId, apiKey } = bootstrap.data;
  if (!workspaceId || !apiKey?.startsWith('iris_')) {
    fail(`Bootstrap returned unexpected payload: ${JSON.stringify(bootstrap)}`);
  }
  console.log(`Workspace: ${workspaceId}`);
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  step('5/8 Create demo-mode HubSpot connector instance');
  const created = (await api('/api/v1/connectors', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      workspaceId,
      connectorId: 'hubspot',
      config: { portalId: 'demo-portal', demoMode: true },
    }),
  })) as { data: { id: string } };
  const instanceId = created.data.id;
  console.log(`Connector instance: ${instanceId}`);

  step('6/8 Trigger sync and wait for completion');
  await api(`/api/v1/connectors/${instanceId}/sync?workspaceId=${workspaceId}`, {
    method: 'POST',
    headers: auth,
  });

  const countSql = postgres(DATABASE_URL, { max: 1 });
  let indexedCount = 0;
  await waitFor(`${EXPECTED_ENTITY_COUNT} entities indexed for workspace ${workspaceId}`, 120_000, async () => {
    const [row] = await countSql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM iris_entities WHERE workspace_id = ${workspaceId}
    `;
    indexedCount = Number(row?.count ?? 0);
    console.log(`  indexed entities: ${indexedCount}/${EXPECTED_ENTITY_COUNT}`);
    return indexedCount >= EXPECTED_ENTITY_COUNT;
  });

  step('7/8 Verify indexed entity counts per type');
  const rows = await countSql<{ type: string; count: string }[]>`
    SELECT type, COUNT(*) AS count FROM iris_entities
    WHERE workspace_id = ${workspaceId}
    GROUP BY type ORDER BY type
  `;
  const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.count)]));
  console.log(`Counts by type: ${JSON.stringify(byType)}`);

  const expected = { company: 4, contact: 8, deal: 10 };
  for (const [type, count] of Object.entries(expected)) {
    if (byType[type] !== count) {
      fail(`Expected ${count} ${type} entities, found ${byType[type] ?? 0}`);
    }
  }

  await countSql.end();
  await adminSql.end();

  step('8/8 MCP query phase — canonical questions over stdio');
  await withTimeout(180_000, new Promise<void>((resolve) => {
    const queryClient = spawn('node', ['--import', 'tsx', 'src/slice-query-client.ts'], {
      cwd: join(ROOT, 'apps', 'mcp-server'),
      env: { ...CHILD_ENV, IRIS_API_KEY: apiKey, SLICE_WORKSPACE_ID: workspaceId },
      stdio: 'inherit',
    });
    queryClient.on('exit', (code) => {
      if (code !== 0) fail(`MCP query phase exited with code ${code}`);
      resolve();
    });
  })).catch((e: unknown) => fail(`MCP query phase timed out or crashed: ${e instanceof Error ? e.message : String(e)}`));

  console.log('\nSLICE DEMO (connect → sync → index → serve → query → answer): PASS');
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
