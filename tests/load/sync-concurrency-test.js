/**
 * Sync concurrency test: parallel connector syncs measuring throughput and peak memory.
 * Simulates 3+ concurrent connector syncs via the API.
 *
 * Usage: node tests/load/sync-concurrency-test.js
 * Requires: LOAD_TEST_BASE_URL env var (default: http://localhost:3001)
 */

import { computeLatencyStats, formatResult, THRESHOLDS } from './load-test-config.js';

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
const API_KEY = process.env.LOAD_TEST_API_KEY ?? 'test-key';

const CONNECTOR_IDS = [
  process.env.CONNECTOR_1_ID ?? 'connector-hubspot-test',
  process.env.CONNECTOR_2_ID ?? 'connector-salesforce-test',
  process.env.CONNECTOR_3_ID ?? 'connector-stripe-test',
];

async function triggerSync(connectorId) {
  const start = performance.now();
  let entityCount = 0;
  let error = null;
  let statusCode = 0;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/connectors/${connectorId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ mode: 'full' }),
      signal: AbortSignal.timeout(60_000),
    });
    statusCode = res.status;
    const body = await res.json();
    entityCount = (body?.data?.entitiesSynced ?? 0) as number;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { connectorId, latencyMs: Math.round(performance.now() - start), entityCount, statusCode, error };
}

function sampleMemoryMb() {
  const mem = process.memoryUsage();
  return Math.round(mem.heapUsed / 1024 / 1024);
}

console.log(`\nRunning sync concurrency test with ${CONNECTOR_IDS.length} connectors in parallel…`);
const peakMemSamples = [];
const memSampler = setInterval(() => peakMemSamples.push(sampleMemoryMb()), 500);

const syncStart = performance.now();
const syncResults = await Promise.allSettled(CONNECTOR_IDS.map(id => triggerSync(id)));
clearInterval(memSampler);

const durationMs = Math.round(performance.now() - syncStart);
const totalEntities = syncResults.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.entityCount : 0), 0);
const entitiesPerSec = durationMs > 0 ? Math.round((totalEntities / durationMs) * 1000) : 0;
const peakMemMb = Math.max(...peakMemSamples, 0);
const errors = syncResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)).map(r => r.status === 'rejected' ? String(r.reason) : (r.status === 'fulfilled' ? r.value.error : '') ?? '');
const latencies = syncResults.filter(r => r.status === 'fulfilled').map(r => r.value.latencyMs);
const stats = computeLatencyStats(latencies);
const meetsThreshold = entitiesPerSec >= THRESHOLDS.SYNC_ENTITIES_PER_SEC || totalEntities === 0;

const result = {
  scenario: `sync-concurrency (${CONNECTOR_IDS.length} connectors)`,
  rps: CONNECTOR_IDS.length,
  duration: Math.round(durationMs / 1000),
  totalRequests: CONNECTOR_IDS.length,
  successRate: (CONNECTOR_IDS.length - errors.filter(Boolean).length) / CONNECTOR_IDS.length,
  latency: stats,
  errors: errors.filter(Boolean).slice(0, 5),
  peakMemoryMb: peakMemMb,
  entitiesPerSec,
  meetsThreshold,
  thresholdDetails: `${entitiesPerSec} entities/sec (threshold: ${THRESHOLDS.SYNC_ENTITIES_PER_SEC}/sec) peakMem=${peakMemMb}MB totalEntities=${totalEntities}`,
};

console.log(formatResult(result));
console.log(`\nSync concurrency test complete: ${meetsThreshold ? 'PASS' : 'FAIL'}`);
if (!meetsThreshold) process.exit(1);
