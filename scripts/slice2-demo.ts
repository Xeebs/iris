/**
 * Slice 2 demo driver (docs/SLICE_2.md).
 *
 * From a clean state:
 *   1. Reset Iris DB (drop/recreate schema + migrate)
 *   2. Align embedding column dimension to the configured provider (ollama=768)
 *   3. Seed iris_demo_source with scripts/seed-business-db.sql (live Postgres source)
 *   4. Start API server + sync worker (EMBEDDING_PROVIDER=ollama — real vectors)
 *   5. Bootstrap workspace + API key
 *   6. Create postgres connector instance pointing at iris_demo_source
 *   7. Trigger sync; wait for all 98 entities to be indexed
 *   8. Verify entity counts per type
 *   9. Run eval harness (apps/mcp-server/src/eval-retrieval.ts) — 22 questions,
 *      ≥90% accuracy, ≥70% token savings
 *
 * Run via scripts/slice2-demo.sh (which enforces EMBEDDING_PROVIDER ≠ hash-deterministic).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import postgres from 'postgres';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const API_DIR = join(ROOT, 'apps', 'api');
const MCP_DIR = join(ROOT, 'apps', 'mcp-server');

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const DEMO_SOURCE_DATABASE_URL =
  process.env['DEMO_SOURCE_DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris_demo_source';
const PORT = Number(process.env['SLICE_DEMO_PORT'] ?? 3902);
const BASE = `http://localhost:${PORT}`;

// 20 companies + 48 contacts + 30 deals = 98 entities from seed-business-db.sql
const EXPECTED_ENTITY_COUNT = 98;
const EXPECTED_BY_TYPE = { company: 20, contact: 48, deal: 30 };

/** Derive the embedding vector dimension from the configured provider. */
function embeddingDimensions(): number {
  const provider = process.env['EMBEDDING_PROVIDER'] ?? 'ollama';
  // Ollama nomic-embed-text produces 768-dim vectors
  if (provider === 'ollama') return 768;
  // OpenAI text-embedding-3-small / ada-002 default to 1536
  return 1536;
}

const EMBEDDING_DIMS = embeddingDimensions();

const CHILD_ENV: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    DEMO_MODE: 'true',
    DATABASE_URL,
    REDIS_URL,
    PORT: String(PORT),
    SYNC_WORKER_STANDALONE: 'true',
    EMBEDDING_PROVIDER: process.env['EMBEDDING_PROVIDER'] ?? 'ollama',
    ...(process.env['OLLAMA_ENDPOINT'] ? { OLLAMA_ENDPOINT: process.env['OLLAMA_ENDPOINT'] } : {}),
    ...(process.env['OPENAI_API_KEY'] ? { OPENAI_API_KEY: process.env['OPENAI_API_KEY'] } : {}),
  }).filter((kv): kv is [string, string] => kv[1] !== undefined),
);

const children: ChildProcess[] = [];

function step(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function fail(message: string): never {
  console.error(`\nSLICE 2 DEMO FAILED: ${message}`);
  for (const child of children) child.kill('SIGTERM');
  process.exit(1);
}

function startProcess(name: string, scriptPath: string, cwd: string): ChildProcess {
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

/** Derive admin DB URL: replace the database name with 'postgres' for DDL operations. */
function adminDbUrl(url: string): string {
  return url.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');
}

async function main(): Promise<void> {
  step('1/9 Reset Iris database (drop + recreate schema)');
  const irisSql = postgres(DATABASE_URL, { max: 1 });
  try {
    await irisSql.unsafe('DROP SCHEMA public CASCADE');
    await irisSql.unsafe('CREATE SCHEMA public');
    await irisSql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (e) {
    fail(`Could not reset Iris DB at ${DATABASE_URL}: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log('Iris database reset.');

  step('2/9 Run Iris migrations');
  await withTimeout(60_000, new Promise<void>((resolve) => {
    const migrate = spawn('node', ['--import', 'tsx', 'src/db/migrate.ts'], {
      cwd: API_DIR,
      env: CHILD_ENV,
      stdio: 'inherit',
    });
    migrate.on('exit', (code) => {
      if (code !== 0) fail(`Migrations exited with code ${code}`);
      resolve();
    });
  })).catch((e: unknown) => fail(`Migration timed out: ${e instanceof Error ? e.message : String(e)}`));

  if (EMBEDDING_DIMS !== 1536) {
    step(`2b/9 Align embedding column to vector(${EMBEDDING_DIMS}) for ${process.env['EMBEDDING_PROVIDER'] ?? 'ollama'}`);
    // Standard migrations create vector(1536) (default for OpenAI/hash-deterministic).
    // When the provider uses a different dimension, align the column before the API
    // server starts so the PgvectorStore dimension-guard passes.
    try {
      await irisSql.unsafe('DROP INDEX IF EXISTS iris_entities_embedding_idx');
      await irisSql.unsafe(`ALTER TABLE iris_entities DROP COLUMN IF EXISTS embedding CASCADE`);
      await irisSql.unsafe(`ALTER TABLE iris_entities ADD COLUMN embedding vector(${EMBEDDING_DIMS})`);
      await irisSql.unsafe(`
        CREATE INDEX iris_entities_embedding_idx
        ON iris_entities USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
      // Recreate compat views removed by CASCADE (originally from migration 180)
      await irisSql.unsafe(`DROP VIEW IF EXISTS indexed_entities`);
      await irisSql.unsafe(`
        CREATE VIEW indexed_entities AS
        SELECT id, workspace_id, type, type AS entity_type, label, attributes,
               relationships, last_modified, source_id,
               split_part(source_id, ':', 1) AS source_connector_id,
               embedding, indexed_at
        FROM iris_entities
      `);
      await irisSql.unsafe(`DROP VIEW IF EXISTS entity_vectors`);
      await irisSql.unsafe(`
        CREATE VIEW entity_vectors AS
        SELECT id AS entity_id, workspace_id, embedding
        FROM iris_entities WHERE embedding IS NOT NULL
      `);
    } catch (e) {
      fail(`Embedding dimension alignment failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(`Embedding column aligned to vector(${EMBEDDING_DIMS}).`);
  }

  step('3/9 Seed iris_demo_source (real Postgres business dataset)');
  const sysAdminSql = postgres(adminDbUrl(DEMO_SOURCE_DATABASE_URL), { max: 1 });
  try {
    await sysAdminSql.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'iris_demo_source' AND pid <> pg_backend_pid()`,
    );
    await sysAdminSql.unsafe('DROP DATABASE IF EXISTS iris_demo_source');
    await sysAdminSql.unsafe('CREATE DATABASE iris_demo_source');
  } catch (e) {
    fail(`Could not create iris_demo_source: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await sysAdminSql.end();
  }

  const seedSql = readFileSync(join(ROOT, 'scripts', 'seed-business-db.sql'), 'utf8');
  const demoSql = postgres(DEMO_SOURCE_DATABASE_URL, { max: 1 });
  try {
    await demoSql.unsafe(seedSql);
  } catch (e) {
    fail(`Could not seed iris_demo_source: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await demoSql.end();
  }
  console.log('iris_demo_source seeded (20 companies, 48 contacts, 30 deals).');

  // Pre-flight: verify Ollama is responsive before starting the API server.
  // A missing/offline Ollama turns sync into a 8-minute timeout instead of a fast fail.
  const embeddingProvider = process.env['EMBEDDING_PROVIDER'] ?? 'ollama';
  if (embeddingProvider === 'ollama') {
    const ollamaEndpoint = process.env['OLLAMA_ENDPOINT'] ?? 'http://localhost:11434';
    step(`3b/9 Verify Ollama is reachable at ${ollamaEndpoint}`);
    try {
      const res = await withTimeout(10_000, fetch(`${ollamaEndpoint}/api/tags`));
      if (!res.ok) fail(`Ollama API returned HTTP ${res.status} — is nomic-embed-text pulled?`);
      console.log('Ollama is responding.');
    } catch (e: unknown) {
      fail(
        `Ollama is not reachable at ${ollamaEndpoint}.\n` +
          `  Start it with: ollama serve\n` +
          `  Pull the model: ollama pull nomic-embed-text\n` +
          `  Or set EMBEDDING_PROVIDER=openai to use OpenAI instead.\n` +
          `  Error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  step(`4/9 Start API server + sync worker (${embeddingProvider} embeddings)`);
  startProcess('api', 'src/server.ts', API_DIR);
  startProcess('worker', 'src/workers/sync-worker.ts', API_DIR);
  // Allow 120s for the API to start — Ollama on CPU can be slow and delay first startup.
  await waitFor('API /health to return ok', 120_000, async () => {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  });
  console.log(`API is healthy.`);

  step('5/9 Bootstrap workspace + MCP API key');
  const bootstrap = (await api('/api/v1/demo/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Slice 2 Demo Workspace' }),
  })) as { data: { workspaceId: string; apiKey: string } };
  const { workspaceId, apiKey } = bootstrap.data;
  if (!workspaceId || !apiKey?.startsWith('iris_')) {
    fail(`Bootstrap returned unexpected payload: ${JSON.stringify(bootstrap)}`);
  }
  console.log(`Workspace: ${workspaceId}`);
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  step('6/9 Create postgres connector instance pointing at iris_demo_source');
  const created = (await api('/api/v1/connectors', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      workspaceId,
      connectorId: 'postgres',
      config: {
        connectionString: DEMO_SOURCE_DATABASE_URL,
        tables: [
          { name: 'companies', entityType: 'company', labelColumn: 'name', updatedAtColumn: 'created_at' },
          { name: 'contacts', entityType: 'contact', labelColumns: ['first_name', 'last_name'], updatedAtColumn: 'updated_at' },
          { name: 'deals', entityType: 'deal', labelColumn: 'name', updatedAtColumn: 'close_date' },
        ],
      },
    }),
  })) as { data: { id: string } };
  const instanceId = created.data.id;
  console.log(`Connector instance: ${instanceId}`);

  step('7/9 Trigger sync and wait for all entities to be indexed');
  await api(`/api/v1/connectors/${instanceId}/sync?workspaceId=${workspaceId}`, {
    method: 'POST',
    headers: auth,
  });

  const countSql = postgres(DATABASE_URL, { max: 1 });
  let indexedCount = 0;
  // Real embeddings on CPU take longer — allow 8 minutes for 98 entities
  await waitFor(`${EXPECTED_ENTITY_COUNT} entities indexed for workspace ${workspaceId}`, 480_000, async () => {
    const [row] = await countSql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM iris_entities WHERE workspace_id = ${workspaceId}
    `;
    indexedCount = Number(row?.count ?? 0);
    process.stdout.write(`\r  indexed entities: ${indexedCount}/${EXPECTED_ENTITY_COUNT} `);
    return indexedCount >= EXPECTED_ENTITY_COUNT;
  });
  console.log(`\n  All ${indexedCount} entities indexed.`);

  step('8/9 Verify indexed entity counts per type');
  const rows = await countSql<{ type: string; count: string }[]>`
    SELECT type, COUNT(*) AS count FROM iris_entities
    WHERE workspace_id = ${workspaceId}
    GROUP BY type ORDER BY type
  `;
  const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.count)]));
  console.log(`Counts by type: ${JSON.stringify(byType)}`);

  for (const [type, expected] of Object.entries(EXPECTED_BY_TYPE)) {
    if (byType[type] !== expected) {
      fail(`Expected ${expected} ${type} entities, found ${byType[type] ?? 0}`);
    }
  }

  await countSql.end();
  await irisSql.end();

  step('9/9 Run eval harness — 22 questions, ≥90% accuracy, ≥70% token savings');
  const evalEnv: Record<string, string> = {
    ...CHILD_ENV,
    IRIS_API_KEY: apiKey,
    SLICE_WORKSPACE_ID: workspaceId,
    DEMO_SOURCE_DATABASE_URL,
  };

  await withTimeout(300_000, new Promise<void>((resolve) => {
    const evalProcess = spawn(
      'node',
      ['--import', 'tsx', 'src/eval-retrieval.ts'],
      { cwd: MCP_DIR, env: evalEnv, stdio: 'inherit' },
    );
    evalProcess.on('exit', (code) => {
      if (code !== 0) fail(`Eval harness exited with code ${code}`);
      resolve();
    });
  })).catch((e: unknown) => fail(`Eval harness timed out or crashed: ${e instanceof Error ? e.message : String(e)}`));

  console.log('\nSLICE 2 DEMO (real data → real embeddings → eval ≥90% accuracy ≥70% savings): PASS');
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
