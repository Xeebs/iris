/**
 * Scripted MCP client for the vertical slice demo (docs/VERTICAL_SLICE.md).
 *
 * Spawns the MCP server over stdio — the same transport a real Claude client
 * uses — authenticated with the demo workspace API key, then calls
 * `query-context` with the 5 canonical questions and asserts each response
 * contains the expected fixture facts within the 2000-token contextBudget.
 *
 * Invoked by scripts/slice-demo.ts with env:
 *   IRIS_API_KEY, SLICE_WORKSPACE_ID, DATABASE_URL, REDIS_URL,
 *   EMBEDDING_PROVIDER=hash-deterministic
 *
 * Exit 0 = all questions answered with the expected facts.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTEXT_BUDGET = 2000;

type CanonicalQuestion = {
  question: string;
  expectedFacts: string[];
};

// Grounded in packages/connectors/hubspot/tests/fixtures/ — update together.
const CANONICAL_QUESTIONS: CanonicalQuestion[] = [
  {
    question: 'How many open deals do we have, and what is their total value?',
    expectedFacts: [
      'Acme Annual Contract',
      '120000',
      'Globex Pilot Expansion',
      '45000',
      'Acme Cloud Migration',
      '30000',
    ],
  },
  {
    question: 'Which company does Alice Smith work for?',
    expectedFacts: ['Alice Smith', 'Acme Corp'],
  },
  {
    question: 'List our deals in the negotiation stage.',
    expectedFacts: ['negotiation', 'Acme Annual Contract', 'Globex Pilot Expansion'],
  },
  {
    question: 'Who is the owner of our largest deal?',
    expectedFacts: ['Acme Annual Contract', '120000', 'owner: 50'],
  },
  {
    question: 'Which contacts belong to Acme Corp?',
    expectedFacts: ['Alice Smith', 'Carol White'],
  },
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main(): Promise<void> {
  const workspaceId = process.env['SLICE_WORKSPACE_ID'];
  if (!workspaceId) {
    console.error('SLICE_WORKSPACE_ID is required');
    process.exit(1);
  }
  if (!process.env['IRIS_API_KEY']) {
    console.error('IRIS_API_KEY is required');
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
    env: Object.fromEntries(
      Object.entries(process.env).filter((kv): kv is [string, string] => kv[1] !== undefined),
    ),
  });

  const client = new Client({ name: 'iris-slice-demo-client', version: '1.0.0' });
  await client.connect(transport);
  console.log('MCP client connected over stdio.');

  let failures = 0;

  for (const [i, { question, expectedFacts }] of CANONICAL_QUESTIONS.entries()) {
    const result = await client.callTool({
      name: 'query-context',
      arguments: { query: question, workspaceId, contextBudget: CONTEXT_BUDGET },
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    const tokens = estimateTokens(text);
    const missing = expectedFacts.filter((fact) => !text.includes(fact));
    const overBudget = tokens > CONTEXT_BUDGET;
    const isError = result.isError === true || text.startsWith('Error:');

    if (missing.length > 0 || overBudget || isError) {
      failures++;
      console.error(`\nQ${i + 1} FAIL: ${question}`);
      if (isError) console.error(`  tool returned an error`);
      if (missing.length > 0) console.error(`  missing facts: ${JSON.stringify(missing)}`);
      if (overBudget) console.error(`  over budget: ~${tokens} tokens > ${CONTEXT_BUDGET}`);
      console.error(`  expected facts: ${JSON.stringify(expectedFacts)}`);
      console.error(`  actual response:\n${text}`);
    } else {
      console.log(`Q${i + 1} PASS (~${tokens} tokens): ${question}`);
    }
  }

  await client.close();

  if (failures > 0) {
    console.error(`\nMCP QUERY PHASE: ${failures}/${CANONICAL_QUESTIONS.length} canonical questions FAILED`);
    process.exit(1);
  }
  console.log(`\nMCP QUERY PHASE: all ${CANONICAL_QUESTIONS.length} canonical questions PASS`);
  process.exit(0);
}

main().catch((e) => {
  console.error('MCP query client failed:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
