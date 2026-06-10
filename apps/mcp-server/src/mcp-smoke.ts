/**
 * MCP smoke test — CI-checkable proxy for the Slice 2 owner-verified criterion.
 *
 * Spawns the Iris MCP server over stdio (exactly as Claude Code does), lists tools,
 * calls query-context once, and asserts a non-empty in-budget response.
 *
 * Invoked by scripts/mcp-smoke.ts (which sets cwd to apps/mcp-server/).
 *
 * Required env:
 *   DATABASE_URL          — Iris Postgres connection string
 *   WORKSPACE_ID          — workspace to query (or SLICE_WORKSPACE_ID as alias)
 *
 * Optional env:
 *   IRIS_API_KEY          — MCP API key; omit for unauthenticated dev mode
 *   REDIS_URL             — defaults to redis://localhost:6379
 *   EMBEDDING_PROVIDER    — ollama | openai (defaults to ollama)
 *   OLLAMA_ENDPOINT       — defaults to http://localhost:11434
 *
 * Exit 0 = smoke test passes. Exit 1 = any assertion fails.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { estimateTokens } from '@iris/semantic-core/llm-router';

const CONTEXT_BUDGET = 2000;
const SMOKE_QUERY = 'list contacts and companies';

function fail(msg: string): never {
  console.error(`\nSMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) fail('DATABASE_URL is required');

  const workspaceId = process.env['WORKSPACE_ID'] ?? process.env['SLICE_WORKSPACE_ID'];
  if (!workspaceId) {
    fail(
      'WORKSPACE_ID (or SLICE_WORKSPACE_ID) is required.\n' +
        '  Get it from the dashboard (Settings → API Keys) or from the demo bootstrap:\n' +
        '    curl -X POST http://localhost:3000/api/v1/demo/bootstrap \\\n' +
        '      -H "Content-Type: application/json" \\\n' +
        "      -d '{\"name\": \"Smoke Test Workspace\"}'",
    );
  }

  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((kv): kv is [string, string] => kv[1] !== undefined),
  );

  console.log(`Workspace: ${workspaceId}`);
  console.log(`Embedding provider: ${env['EMBEDDING_PROVIDER'] ?? 'ollama'}`);
  console.log(env['IRIS_API_KEY'] ? 'IRIS_API_KEY: set' : 'IRIS_API_KEY: not set (dev mode)');
  console.log('');

  // Spawn the MCP server over stdio, exactly as Claude Code does.
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', 'src/server.ts'],
    env,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'iris-smoke-test', version: '1.0.0' });

  transport.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  await client.connect(transport);
  console.log('MCP client connected over stdio.\n');

  // 1. List tools — verify query-context is registered.
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  console.log(`Available tools (${tools.length}): ${toolNames.join(', ')}`);

  if (!toolNames.includes('query-context')) {
    await client.close();
    fail('query-context tool not found in tool list');
  }
  console.log('query-context: present ✓\n');

  // 2. Call query-context — assert non-empty, in-budget response.
  console.log(`Calling query-context: "${SMOKE_QUERY}"...`);
  const t0 = Date.now();
  const result = await client.callTool({
    name: 'query-context',
    arguments: { query: SMOKE_QUERY, workspaceId, contextBudget: CONTEXT_BUDGET },
  });
  const latencyMs = Date.now() - t0;

  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');

  if (result.isError === true) {
    await client.close();
    fail(`query-context returned an error: ${text}`);
  }

  if (!text || text.trim().length === 0) {
    await client.close();
    fail(
      'query-context returned an empty response.\n' +
        '  Ensure at least one connector has synced data into this workspace.',
    );
  }

  const tokens = estimateTokens(text);
  if (tokens > CONTEXT_BUDGET) {
    await client.close();
    fail(`query-context response exceeds contextBudget: ~${tokens} tokens > ${CONTEXT_BUDGET}`);
  }

  console.log(`query-context: ~${tokens} tokens, ${latencyMs}ms (budget ${CONTEXT_BUDGET}) ✓`);
  console.log(
    `Response preview: ${text.slice(0, 300).replace(/\n/g, ' ')}${text.length > 300 ? '...' : ''}\n`,
  );

  await client.close();
  console.log('MCP smoke test PASSED ✓');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('Smoke test crashed:', e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
