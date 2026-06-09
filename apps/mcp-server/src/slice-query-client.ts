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

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { estimateTokens } from '@iris/semantic-core/llm-router';

const CONTEXT_BUDGET = 2000;
const REQUIRED_SAVINGS_RATIO = 0.7;

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const FIXTURES_DIR = join(ROOT, 'packages', 'connectors', 'hubspot', 'tests', 'fixtures');

type CanonicalQuestion = {
  question: string;
  expectedFacts: string[];
  /** Fixture files a user would paste raw to answer this question (the baseline). */
  baselineFixtures: string[];
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
    baselineFixtures: ['deals.json'],
  },
  {
    question: 'Which company does Alice Smith work for?',
    expectedFacts: ['Alice Smith', 'Acme Corp'],
    baselineFixtures: ['contacts.json', 'companies.json'],
  },
  {
    question: 'List our deals in the negotiation stage.',
    expectedFacts: ['negotiation', 'Acme Annual Contract', 'Globex Pilot Expansion'],
    baselineFixtures: ['deals.json'],
  },
  {
    question: 'Who is the owner of our largest deal?',
    expectedFacts: ['Acme Annual Contract', '120000', 'owner: 50'],
    baselineFixtures: ['deals.json'],
  },
  {
    question: 'Which contacts belong to Acme Corp?',
    expectedFacts: ['Alice Smith', 'Carol White'],
    baselineFixtures: ['contacts.json', 'companies.json'],
  },
];

async function baselineTokens(fixtures: string[]): Promise<number> {
  let total = 0;
  for (const file of fixtures) {
    total += estimateTokens(await readFile(join(FIXTURES_DIR, file), 'utf8'));
  }
  return total;
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
  const reportRows: Array<{ question: string; irisTokens: number; baseline: number; savings: number }> = [];

  for (const [i, { question, expectedFacts, baselineFixtures }] of CANONICAL_QUESTIONS.entries()) {
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
    const baseline = await baselineTokens(baselineFixtures);
    const savings = baseline > 0 ? 1 - tokens / baseline : 0;
    reportRows.push({ question, irisTokens: tokens, baseline, savings });

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
      console.log(`Q${i + 1} PASS (~${tokens} tokens vs ${baseline} raw, ${(savings * 100).toFixed(1)}% saved): ${question}`);
    }
  }

  await client.close();

  const totalIris = reportRows.reduce((s, r) => s + r.irisTokens, 0);
  const totalBaseline = reportRows.reduce((s, r) => s + r.baseline, 0);
  const overallSavings = totalBaseline > 0 ? 1 - totalIris / totalBaseline : 0;

  const table = [
    '| # | Question | Iris tokens | Raw-paste tokens | Savings |',
    '|---|----------|-------------|------------------|---------|',
    ...reportRows.map(
      (r, i) =>
        `| ${i + 1} | ${r.question} | ${r.irisTokens} | ${r.baseline} | ${(r.savings * 100).toFixed(1)}% |`,
    ),
    `| | **Total** | **${totalIris}** | **${totalBaseline}** | **${(overallSavings * 100).toFixed(1)}%** |`,
  ].join('\n');

  console.log('\nTOKEN SAVINGS REPORT (Iris query-context vs raw fixture paste)');
  console.log(table);

  const report = [
    '# Vertical Slice — Token Savings Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Workspace: ${workspaceId}`,
    '',
    'Baseline = estimated tokens of the raw HubSpot fixture JSON a user would',
    'paste to answer each question. Iris = `query-context` response tokens',
    `(contextBudget ${CONTEXT_BUDGET}). Both use the shared length/4 estimator.`,
    '',
    table,
    '',
    `Required savings: ≥ ${REQUIRED_SAVINGS_RATIO * 100}% — ${overallSavings >= REQUIRED_SAVINGS_RATIO ? 'MET' : 'NOT MET'}`,
    '',
  ].join('\n');
  await writeFile(join(ROOT, 'pipeline', 'slice-report.md'), report, 'utf8');
  console.log('Report written to pipeline/slice-report.md');

  if (failures > 0) {
    console.error(`\nMCP QUERY PHASE: ${failures}/${CANONICAL_QUESTIONS.length} canonical questions FAILED`);
    process.exit(1);
  }
  if (overallSavings < REQUIRED_SAVINGS_RATIO) {
    console.error(
      `\nTOKEN SAVINGS GATE FAILED: ${(overallSavings * 100).toFixed(1)}% < ${REQUIRED_SAVINGS_RATIO * 100}% — ` +
        'investigate the compression/retrieval path (do not game the baseline).',
    );
    process.exit(1);
  }
  console.log(
    `\nMCP QUERY PHASE: all ${CANONICAL_QUESTIONS.length} canonical questions PASS, ` +
      `overall savings ${(overallSavings * 100).toFixed(1)}% (≥ ${REQUIRED_SAVINGS_RATIO * 100}% required)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('MCP query client failed:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
