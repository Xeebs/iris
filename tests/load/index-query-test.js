/**
 * Index query performance test: vector search on large datasets with varying complexity.
 * Tests sequential and concurrent queries against the indexed entity store.
 *
 * Usage: node tests/load/index-query-test.js
 * Requires: LOAD_TEST_BASE_URL env var (default: http://localhost:3001)
 */

import { computeLatencyStats, formatResult, THRESHOLDS } from './load-test-config.js';

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
const API_KEY = process.env.LOAD_TEST_API_KEY ?? 'test-key';

const QUERY_SCENARIOS = [
  { name: 'simple-semantic', query: 'find customers in New York', filters: {}, topK: 10 },
  { name: 'filtered-type', query: 'enterprise deals over $100k', filters: { type: 'deal', minValue: 100000 }, topK: 20 },
  { name: 'multi-entity', query: 'contacts associated with deals closing this quarter', filters: {}, topK: 50 },
  { name: 'broad-scan', query: 'all active customers', filters: { status: 'active' }, topK: 100 },
  { name: 'complex-relation', query: 'customers with support tickets and recent purchases', filters: {}, topK: 30 },
];

const CONCURRENCIES = [1, 10, 25];

async function vectorQuery(scenario) {
  const start = performance.now();
  let resultCount = 0;
  let error = null;
  let statusCode = 0;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/entities/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ query: scenario.query, filters: scenario.filters, topK: scenario.topK }),
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    const body = await res.json();
    resultCount = Array.isArray(body?.data) ? body.data.length : 0;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { latencyMs: Math.round(performance.now() - start), resultCount, statusCode, error };
}

const allResults = [];

for (const scenario of QUERY_SCENARIOS) {
  for (const concurrency of CONCURRENCIES) {
    const runs = Array.from({ length: concurrency * 5 }, () => vectorQuery(scenario));
    const chunks = [];
    for (let i = 0; i < runs.length; i += concurrency) chunks.push(runs.slice(i, i + concurrency));

    const latencies = [];
    const errors = [];
    let successes = 0;
    for (const chunk of chunks) {
      const settled = await Promise.allSettled(chunk);
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          latencies.push(r.value.latencyMs);
          if (r.value.error) errors.push(r.value.error);
          else if (r.value.statusCode >= 200 && r.value.statusCode < 300) successes++;
        }
      }
    }

    const stats = computeLatencyStats(latencies);
    const meetsThreshold = stats.p95 <= THRESHOLDS.API_P95_MS;
    const result = {
      scenario: `index-query[${scenario.name}] concurrency=${concurrency}`,
      rps: concurrency,
      duration: 0,
      totalRequests: latencies.length,
      successRate: latencies.length > 0 ? successes / latencies.length : 0,
      latency: stats,
      errors: [...new Set(errors)].slice(0, 3),
      meetsThreshold,
      thresholdDetails: `p95=${stats.p95}ms (threshold: ${THRESHOLDS.API_P95_MS}ms)`,
    };
    console.log(formatResult(result));
    allResults.push(result);
  }
}

const allPass = allResults.every(r => r.meetsThreshold);
console.log(`\nIndex query test complete: ${allPass ? 'ALL PASS' : 'SOME FAILURES'}`);
if (!allPass) process.exit(1);
