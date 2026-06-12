/**
 * MCP smoke test launcher.
 *
 * Runs apps/mcp-server/src/mcp-smoke.ts with cwd set to apps/mcp-server/
 * so that module resolution and the stdio server spawn work correctly.
 *
 * Usage:
 *   SLICE_WORKSPACE_ID=<id> IRIS_API_KEY=<key> DATABASE_URL=<url> \
 *     node --import tsx scripts/mcp-smoke.ts
 *
 * WORKSPACE_ID is accepted as an alias for SLICE_WORKSPACE_ID.
 *
 * See apps/mcp-server/src/mcp-smoke.ts for full docs.
 * See docs/CONNECT_CLAUDE.md for setup instructions.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MCP_DIR = join(ROOT, 'apps', 'mcp-server');

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((kv): kv is [string, string] => kv[1] !== undefined),
);

const child = spawn('node', ['--import', 'tsx', 'src/mcp-smoke.ts'], {
  cwd: MCP_DIR,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
