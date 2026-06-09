/**
 * Database migration runner.
 * Executes SQL migration files in order from migrations/.
 *
 * Run via: pnpm db:migrate
 */

import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/iris';

let currentFile = '(unknown)';

async function runMigrations(): Promise<void> {
  const sql = postgres(DATABASE_URL);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _iris_migrations (
        id        SERIAL PRIMARY KEY,
        filename  TEXT NOT NULL UNIQUE,
        run_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      console.log('No migrations directory found — nothing to run.');
      return;
    }

    for (const file of files) {
      const [already] =
        await sql`SELECT 1 FROM _iris_migrations WHERE filename = ${file}`;
      if (already) {
        console.log(`  skip  ${file}`);
        continue;
      }

      currentFile = file;
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _iris_migrations (filename) VALUES (${file})`;
      });
      console.log(`  ran   ${file}`);
    }

    console.log('Migrations complete.');
  } finally {
    await sql.end();
  }
}

runMigrations().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`MIGRATION_ERROR file=${currentFile} error=${message}\n`);
  process.exit(1);
});
