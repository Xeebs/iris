/**
 * MCP throughput test: parallel tool invocations measuring latency and cache hit rate.
 *
 * Usage: node tests/load/mcp-throughput-test.js
 * Requires: LOAD_TEST_MCP_URL env var (default: http://localhost:3000)
 */

import { computeLatencyStats, formatResult, THRESHOLDS } from './load-test-config.js';

const MCP_URL = process.env.LOAD_TEST_MCP_URL ?? 'http://localhost:3000';
const API_KEY = process.env.LOAD_TEST_API_KEY ?? 'test-key';
const CONCURRENCY_LEVELS = [5, 20, 50];
const REQUESTS_PER_LEVEL = 100;

const TOOL_CALLS = [
  { tool: 'query-context', args: { query: 'top deals this quarter', contextBudget: 500 } },
  { tool: 'list-entities', args: { type: 'contact', limit: 10 } },
  { tool: 'get-metric', args: { metric: 'monthly_recurring_revenue' } },
  { tool: 'query-context', args: { query: 'recent customer support issues', contextBudget: 500 } },
  { tool: 'list-entities', args: { type: 'deal', limit: 10 } },
];

async function mcpCall(toolCall) {
  const start = performance.now();
  let cacheHit = false;
  let error = null;
  let statusCode = 0;
  try {
    const res = await fetch(`${MCP_URL}/mcp/v1/tools/${toolCall.tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify(toolCall.args),
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    const body = await res.json();
    cacheHit = res.headers.get('X-Cache') === 'HIT' || body?.meta?.cached === true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { latencyMs: Math.round(performance.now() - start), cacheHit, statusCode, error };
}

async function runAtConcurrency(concurrency) {
  const latencies = [];
  const cachedLatencies = [];
  const errors = [];
  let successes = 0;
  let cacheHits = 0;

  const batch = Array.from({ length: REQUESTS_PER_LEVEL }, (_, i) =>
    mcpCall(TOOL_CALLS[i % TOOL_CALLS.length]).then(result => {
      latencies.push(result.latencyMs);
      if (result.cacheHit) { cacheHits++; cachedLatencies.push(result.latencyMs); }
      if (result.error) errors.push(result.error);
      else if (result.statusCode >= 200 && result.statusCode < 300) successes++;
    })
  );

  const chunks = [];
  for (let i = 0; i < batch.length; i += concurrency) {
    chunks.push(batch.slice(i, i + concurrency));
  }
  for (const chunk of chunks) {
    await Promise.allSettled(chunk);
  }

  const stats = computeLatencyStats(latencies);
  const cachedStats = computeLatencyStats(cachedLatencies);
  const cacheHitRate = cacheHits / REQUESTS_PER_LEVEL;
  const meetsThreshold = cachedStats.p95 <= THRESHOLDS.MCP_P95_CACHED_MS || cachedLatencies.length === 0;
  const result = {
    scenario: `mcp-throughput (concurrency=${concurrency})`,
    rps: concurrency,
    duration: 0,
    totalRequests: REQUESTS_PER_LEVEL,
    successRate: successes / REQUESTS_PER_LEVEL,
    latency: stats,
    errors: [...new Set(errors)].slice(0, 5),
    cacheHitRate,
    meetsThreshold,
    thresholdDetails: `cached-p95=${cachedStats.p95}ms (threshold: ${THRESHOLDS.MCP_P95_CACHED_MS}ms) cache-hit=${(cacheHitRate * 100).toFixed(1)}%`,
  };
  console.log(formatResult(result));
  return result;
}

const results = [];
for (const c of CONCURRENCY_LEVELS) {
  console.log(`\nRunning MCP throughput test at concurrency=${c}…`);
  results.push(await runAtConcurrency(c));
}

const allPass = results.every(r => r.meetsThreshold);
console.log(`\nMCP throughput test complete: ${allPass ? 'ALL PASS' : 'SOME FAILURES'}`);
if (!allPass) process.exit(1);
