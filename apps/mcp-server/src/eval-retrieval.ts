/**
 * Slice 2 retrieval eval harness (docs/SLICE_2.md).
 *
 * Loads eval-questions.json, queries the running MCP server for each question,
 * and scores: fact accuracy, token savings vs. raw-data-paste baseline,
 * contextBudget compliance, and latency (p50/p95).
 *
 * Invoked by scripts/slice2-demo.sh after the sync worker has indexed all
 * entities. Required env vars:
 *   IRIS_API_KEY          — workspace API key (from demo bootstrap)
 *   SLICE_WORKSPACE_ID    — workspace ID (from demo bootstrap)
 *   DEMO_SOURCE_DATABASE_URL — connection string for iris_demo_source (for baseline)
 *   DATABASE_URL          — Iris DB (for MCP server startup)
 *   REDIS_URL             — Redis (for MCP server startup)
 *   EMBEDDING_PROVIDER=ollama (enforced by slice2-demo.sh)
 *
 * Exit 0 = accuracy ≥ 90% AND total token savings ≥ 70%.
 * Writes pipeline/slice2-eval-report.md (markdown) and
 *        pipeline/slice2-eval-summary.json (machine-readable).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { estimateTokens } from '@iris/semantic-core/llm-router';

const CONTEXT_BUDGET = 2000;
const REQUIRED_ACCURACY = 0.9;
const REQUIRED_SAVINGS = 0.7;

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

type EvalQuestion = {
  id: string;
  question: string;
  expectedFacts: string[];
  category: string;
  notes?: string;
};

type QuestionResult = {
  id: string;
  question: string;
  category: string;
  passed: boolean;
  missingFacts: string[];
  irisTokens: number;
  baselineTokens: number;
  savings: number;
  overBudget: boolean;
  isError: boolean;
  latencyMs: number;
  response: string;
};

function fail(message: string): never {
  console.error(`\nEVAL FAILED: ${message}`);
  process.exit(1);
}

/** Fetch all rows from iris_demo_source to compute the raw-paste baseline. */
async function computeBaseline(demoSourceUrl: string): Promise<number> {
  const sql = postgres(demoSourceUrl, { ssl: false, max: 1 });
  try {
    const companies = await sql`SELECT * FROM companies`;
    const contacts = await sql`SELECT * FROM contacts`;
    const deals = await sql`SELECT * FROM deals`;
    const rawDump = JSON.stringify({ companies, contacts, deals }, null, 2);
    return estimateTokens(rawDump);
  } finally {
    await sql.end();
  }
}

/** Compute percentile of a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function main(): Promise<void> {
  const workspaceId = process.env['SLICE_WORKSPACE_ID'];
  const apiKey = process.env['IRIS_API_KEY'];
  const demoSourceUrl = process.env['DEMO_SOURCE_DATABASE_URL']
    ?? 'postgres://postgres:postgres@localhost:5432/iris_demo_source';

  if (!workspaceId) fail('SLICE_WORKSPACE_ID is required');
  if (!apiKey) fail('IRIS_API_KEY is required');

  // Load questions
  const questionsFile = join(ROOT, 'scripts', 'eval-questions.json');
  const questionsData = JSON.parse(await readFile(questionsFile, 'utf8')) as { questions: EvalQuestion[] };
  const questions = questionsData.questions;
  if (questions.length < 20) {
    fail(`eval-questions.json has only ${questions.length} questions — need ≥ 20`);
  }

  const aggregateQuestions = questions.filter((q) =>
    ['aggregate_superlative', 'aggregate_count'].includes(q.category),
  );
  if (aggregateQuestions.length < 4) {
    fail(`Need ≥ 4 aggregate/superlative questions, found ${aggregateQuestions.length}`);
  }

  console.log(`Loaded ${questions.length} eval questions (${aggregateQuestions.length} aggregate/superlative)`);

  // Compute baseline (raw-paste token count for all source data)
  console.log('Computing raw-data-paste baseline from iris_demo_source...');
  const baselinePerQuestion = await computeBaseline(demoSourceUrl);
  console.log(`Baseline (full source dump): ~${baselinePerQuestion} tokens per question`);

  // Connect MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', 'src/server.ts'],
    env: Object.fromEntries(
      Object.entries(process.env).filter((kv): kv is [string, string] => kv[1] !== undefined),
    ),
  });

  const client = new Client({ name: 'iris-eval-harness', version: '1.0.0' });
  await client.connect(transport);
  console.log('MCP client connected over stdio.\n');

  const results: QuestionResult[] = [];

  for (const [i, question] of questions.entries()) {
    const t0 = Date.now();
    const result = await client.callTool({
      name: 'query-context',
      arguments: { query: question.question, workspaceId, contextBudget: CONTEXT_BUDGET },
    });
    const latencyMs = Date.now() - t0;

    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    const irisTokens = estimateTokens(text);
    const savings = baselinePerQuestion > 0 ? 1 - irisTokens / baselinePerQuestion : 0;
    const overBudget = irisTokens > CONTEXT_BUDGET;
    const isError = result.isError === true || text.startsWith('Error:');
    const missingFacts = isError
      ? question.expectedFacts
      : question.expectedFacts.filter((fact) => !text.includes(fact));
    const passed = !isError && missingFacts.length === 0 && !overBudget;

    results.push({
      id: question.id,
      question: question.question,
      category: question.category,
      passed,
      missingFacts,
      irisTokens,
      baselineTokens: baselinePerQuestion,
      savings,
      overBudget,
      isError,
      latencyMs,
      response: text,
    });

    const status = passed ? 'PASS' : 'FAIL';
    console.log(
      `${status} [${question.id}] ~${irisTokens}t ${latencyMs}ms ${(savings * 100).toFixed(1)}% saved — ${question.question}`,
    );
    if (!passed) {
      if (isError) console.error(`  ERROR response`);
      if (missingFacts.length > 0) console.error(`  missing: ${JSON.stringify(missingFacts)}`);
      if (overBudget) console.error(`  over budget: ${irisTokens} > ${CONTEXT_BUDGET}`);
    }
  }

  await client.close();

  // ── Compute summary metrics ──────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed);
  const accuracy = passed.length / results.length;
  const totalIrisTokens = results.reduce((s, r) => s + r.irisTokens, 0);
  const totalBaseline = baselinePerQuestion * results.length;
  const overallSavings = totalBaseline > 0 ? 1 - totalIrisTokens / totalBaseline : 0;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  const categoryBreakdown = Object.fromEntries(
    ['relationship', 'aggregate_superlative', 'aggregate_count', 'filter', 'entity_lookup'].map((cat) => {
      const catResults = results.filter((r) => r.category === cat);
      const catPassed = catResults.filter((r) => r.passed);
      return [cat, { total: catResults.length, passed: catPassed.length }];
    }),
  );

  // ── Print report to console ──────────────────────────────────────────────────

  const tableRows = results.map(
    (r, i) =>
      `| ${i + 1} | ${r.question.slice(0, 60)} | ${r.irisTokens} | ${r.baselineTokens} | ${(r.savings * 100).toFixed(1)}% | ${r.latencyMs}ms | ${r.passed ? '✓' : '✗'} |`,
  );

  const table = [
    '| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |',
    '|---|----------|-------------|----------|---------|---------|------|',
    ...tableRows,
    `| | **Total** | **${totalIrisTokens}** | **${totalBaseline}** | **${(overallSavings * 100).toFixed(1)}%** | p50:${p50}ms p95:${p95}ms | **${passed.length}/${results.length}** |`,
  ].join('\n');

  console.log('\nSLICE 2 RETRIEVAL EVAL REPORT');
  console.log(table);
  console.log(`\nAccuracy: ${(accuracy * 100).toFixed(1)}% (${passed.length}/${results.length}) — required ≥ ${REQUIRED_ACCURACY * 100}%`);
  console.log(`Token savings: ${(overallSavings * 100).toFixed(1)}% — required ≥ ${REQUIRED_SAVINGS * 100}%`);
  console.log(`Latency: p50 ${p50}ms, p95 ${p95}ms`);

  // ── Write markdown report ─────────────────────────────────────────────────────

  const report = [
    '# Slice 2 — Retrieval Eval Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Workspace: ${workspaceId}`,
    `Embedding provider: ${process.env['EMBEDDING_PROVIDER'] ?? '(unset)'}`,
    '',
    `Baseline = estimated tokens of the full iris_demo_source dump a user would`,
    `paste to answer each question. Iris = \`query-context\` response tokens`,
    `(contextBudget ${CONTEXT_BUDGET}). Both use the shared length/4 estimator.`,
    '',
    table,
    '',
    `## Category Breakdown`,
    '',
    Object.entries(categoryBreakdown)
      .filter(([, v]) => v.total > 0)
      .map(([cat, v]) => `- **${cat}**: ${v.passed}/${v.total} passed`)
      .join('\n'),
    '',
    `## Thresholds`,
    '',
    `| Metric | Required | Actual | Status |`,
    `|--------|----------|--------|--------|`,
    `| Accuracy | ≥ ${(REQUIRED_ACCURACY * 100).toFixed(0)}% | ${(accuracy * 100).toFixed(1)}% | ${accuracy >= REQUIRED_ACCURACY ? '✓ MET' : '✗ NOT MET'} |`,
    `| Token savings | ≥ ${(REQUIRED_SAVINGS * 100).toFixed(0)}% | ${(overallSavings * 100).toFixed(1)}% | ${overallSavings >= REQUIRED_SAVINGS ? '✓ MET' : '✗ NOT MET'} |`,
    `| Query latency p50 | — (measure only) | ${p50}ms | — |`,
    `| Query latency p95 | — (measure only) | ${p95}ms | — |`,
    '',
  ].join('\n');

  await writeFile(join(ROOT, 'pipeline', 'slice2-eval-report.md'), report, 'utf8');
  console.log('Report written to pipeline/slice2-eval-report.md');

  // ── Write machine-readable JSON summary ───────────────────────────────────────

  const summary = {
    generatedAt: new Date().toISOString(),
    workspaceId,
    embeddingProvider: process.env['EMBEDDING_PROVIDER'] ?? null,
    totalQuestions: results.length,
    passedQuestions: passed.length,
    accuracy,
    accuracyMet: accuracy >= REQUIRED_ACCURACY,
    totalIrisTokens,
    totalBaselineTokens: totalBaseline,
    overallSavings,
    savingsMet: overallSavings >= REQUIRED_SAVINGS,
    latencyP50Ms: p50,
    latencyP95Ms: p95,
    categoryBreakdown,
    questions: results.map((r) => ({
      id: r.id,
      question: r.question,
      category: r.category,
      passed: r.passed,
      missingFacts: r.missingFacts,
      irisTokens: r.irisTokens,
      savings: r.savings,
      latencyMs: r.latencyMs,
    })),
  };

  await writeFile(
    join(ROOT, 'pipeline', 'slice2-eval-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  console.log('Summary written to pipeline/slice2-eval-summary.json');

  // ── Exit with pass/fail ───────────────────────────────────────────────────────

  const overallPass = accuracy >= REQUIRED_ACCURACY && overallSavings >= REQUIRED_SAVINGS;

  if (!overallPass) {
    const msgs: string[] = [];
    if (accuracy < REQUIRED_ACCURACY) {
      msgs.push(`accuracy ${(accuracy * 100).toFixed(1)}% < required ${REQUIRED_ACCURACY * 100}%`);
    }
    if (overallSavings < REQUIRED_SAVINGS) {
      msgs.push(`token savings ${(overallSavings * 100).toFixed(1)}% < required ${REQUIRED_SAVINGS * 100}%`);
    }
    fail(`Eval failed: ${msgs.join('; ')}`);
  }

  console.log(
    `\nEVAL HARNESS PASS: accuracy ${(accuracy * 100).toFixed(1)}%, token savings ${(overallSavings * 100).toFixed(1)}%`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('Eval harness failed:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
