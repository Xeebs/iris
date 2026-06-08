/**
 * API stress test: concurrent requests to /api/v1/query-context
 * Measures p50/p95/p99 latencies at 10, 50, 100, 500 RPS.
 *
 * Usage: node tests/load/api-stress-test.js
 * Requires: LOAD_TEST_BASE_URL env var (default: http://localhost:3001)
 */

import { computeLatencyStats, formatResult, THRESHOLDS } from './load-test-config.js';

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
const API_KEY = process.env.LOAD_TEST_API_KEY ?? 'test-key';
const RPS_LEVELS = [10, 50, 100, 500];
const DURATION_SECONDS = 10;

async function singleRequest(query) {
  const start = performance.now();
  let statusCode = 0;
  let error = null;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/query-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ query, contextBudget: 1000 }),
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    await res.text();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { latencyMs: Math.round(performance.now() - start), statusCode, error };
}

async function runAtRps(rps) {
  const intervalMs = 1000 / rps;
  const total = rps * DURATION_SECONDS;
  const latencies = [];
  const errors = [];
  let successes = 0;
  const queue = [];

  const queries = [
    'list top customers by revenue',
    'show deals closing this month',
    'find contacts in healthcare industry',
    'recent support tickets from enterprise accounts',
    'pipeline summary by stage',
  ];

  for (let i = 0; i < total; i++) {
    const delay = i * intervalMs;
    queue.push(
      new Promise(resolve => setTimeout(resolve, delay))
        .then(() => singleRequest(queries[i % queries.length]))
        .then(result => {
          latencies.push(result.latencyMs);
          if (result.error) errors.push(result.error);
          else if (result.statusCode >= 200 && result.statusCode < 300) successes++;
        })
    );
  }

  await Promise.allSettled(queue);
  const stats = computeLatencyStats(latencies);
  const meetsThreshold = stats.p95 <= THRESHOLDS.API_P95_MS;
  const result = {
    scenario: 'api-stress-test /query-context',
    rps,
    duration: DURATION_SECONDS,
    totalRequests: total,
    successRate: successes / total,
    latency: stats,
    errors: [...new Set(errors)].slice(0, 5),
    meetsThreshold,
    thresholdDetails: `p95=${stats.p95}ms (threshold: ${THRESHOLDS.API_P95_MS}ms)`,
  };
  console.log(formatResult(result));
  return result;
}

const results = [];
for (const rps of RPS_LEVELS) {
  console.log(`\nRunning API stress test at ${rps} RPS for ${DURATION_SECONDS}s…`);
  results.push(await runAtRps(rps));
}

const allPass = results.every(r => r.meetsThreshold);
console.log(`\nAPI stress test complete: ${allPass ? 'ALL PASS' : 'SOME FAILURES'}`);
if (!allPass) process.exit(1);
