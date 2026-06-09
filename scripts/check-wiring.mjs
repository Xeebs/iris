#!/usr/bin/env node
/**
 * Wiring check — fails CI when something is built but unreachable.
 *
 * Catches the "80 orphaned routes" failure mode: a module with passing unit
 * tests that is never mounted/registered in the running process. Checks:
 *   1. Every route factory exported from apps/api/src/routes/*.ts is
 *      referenced in apps/api/src/server.ts
 *   2. Every MCP tool module in apps/mcp-server/src/tools/*.ts is imported
 *      in apps/mcp-server/src/server.ts
 *
 * Pre-existing orphans (frozen until the post-slice Layer 77 mounting sweep)
 * live in scripts/wiring-baseline.json — only NEW orphans fail the check.
 * When an orphan gets wired, remove it from the baseline (the check reports
 * stale baseline entries). Regenerate after intentional changes:
 *     node scripts/check-wiring.mjs --update-baseline
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'wiring-baseline.json');

const API_ROUTES_DIR = join(ROOT, 'apps/api/src/routes');
const API_SERVER = join(ROOT, 'apps/api/src/server.ts');
const MCP_TOOLS_DIR = join(ROOT, 'apps/mcp-server/src/tools');
const MCP_SERVER = join(ROOT, 'apps/mcp-server/src/server.ts');

const FACTORY_RE = /export\s+(?:async\s+)?(?:function|const)\s+((?:create|make)\w*(?:Routes|Router))\b/g;

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => e.name);
}

function findOrphans() {
  const orphans = [];

  const apiServer = readFileSync(API_SERVER, 'utf8');
  for (const file of listSources(API_ROUTES_DIR)) {
    const src = readFileSync(join(API_ROUTES_DIR, file), 'utf8');
    for (const match of src.matchAll(FACTORY_RE)) {
      const factory = match[1];
      if (!apiServer.includes(factory)) {
        orphans.push(`api-route:${file}:${factory}`);
      }
    }
  }

  const mcpServer = readFileSync(MCP_SERVER, 'utf8');
  for (const file of listSources(MCP_TOOLS_DIR)) {
    const importPath = `./tools/${file.replace(/\.ts$/, '.js')}`;
    if (!mcpServer.includes(importPath)) {
      orphans.push(`mcp-tool:${file}`);
    }
  }

  return orphans.sort();
}

const orphans = findOrphans();

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(orphans, null, 2)}\n`);
  console.log(`wiring baseline updated: ${orphans.length} known orphan(s)`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`missing/invalid ${BASELINE_PATH} — run with --update-baseline first`);
  process.exit(1);
}

const baselineSet = new Set(baseline);
const newOrphans = orphans.filter((o) => !baselineSet.has(o));
const fixed = baseline.filter((o) => !orphans.includes(o));

if (fixed.length > 0) {
  console.log(`note: ${fixed.length} baseline orphan(s) now wired — remove from wiring-baseline.json:`);
  for (const o of fixed) console.log(`  - ${o}`);
}

if (newOrphans.length > 0) {
  console.error(`\nFAIL: ${newOrphans.length} NEW unwired module(s) — built but unreachable:`);
  for (const o of newOrphans) console.error(`  ✗ ${o}`);
  console.error(
    '\nMount the route in apps/api/src/server.ts / import the tool in apps/mcp-server/src/server.ts,' +
      '\nor (only for deliberate deferral) add it to scripts/wiring-baseline.json with a queue task.'
  );
  process.exit(1);
}

console.log(
  `wiring check OK — ${orphans.length} known orphan(s) in baseline (Layer 77 sweep), 0 new`
);
