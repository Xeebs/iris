# Iris Performance Baseline

## Overview

This document records the established performance baselines for the Iris platform and defines threshold targets for regression alerting. Results are captured by the CI load testing workflow on each merge to `main`.

## Threshold Targets

| Scenario | Metric | Threshold |
|---|---|---|
| API `/query-context` | p95 latency (cache miss) | < 2000ms |
| MCP tool call | p95 latency (cached) | < 500ms |
| Connector sync | Throughput | ≥ 100 entities/sec |

## Test Scenarios

### 1. API Stress Test (`api-stress-test.js`)

Fires concurrent POST requests to `/api/v1/query-context` at 10, 50, 100, and 500 RPS.
Each run lasts 10 seconds. Measures p50/p95/p99 latency, success rate, and error count.

**Target**: p95 ≤ 2000ms at all RPS levels.

### 2. MCP Throughput Test (`mcp-throughput-test.js`)

Executes 100 parallel MCP tool invocations at concurrency 5, 20, and 50.
Tools tested: `query-context`, `list-entities`, `get-metric`.
Tracks cache hit rate and per-tier latency (cached vs uncached).

**Target**: p95 ≤ 500ms for cached responses.

### 3. Sync Concurrency Test (`sync-concurrency-test.js`)

Triggers full syncs on 3 connectors simultaneously.
Measures total entities synced per second and peak heap memory.

**Target**: ≥ 100 entities/sec aggregate throughput.

### 4. Index Query Test (`index-query-test.js`)

Runs 5 query scenario types (simple semantic, filtered, multi-entity, broad scan, complex relation)
at concurrency 1, 10, and 25. Validates vector search scales linearly.

**Target**: p95 ≤ 2000ms at all concurrency levels.

## Scaling Recommendations

### Batch Sizes

- **Embedding batches**: Start at 100 entities/batch (`IndexerConfig.batchSize`). Increase to 200 if p95 embedding latency is under 3s — larger batches amortize API call overhead. Never exceed 500 to avoid timeout risk.
- **Sync pagination**: Cursor pages of 100–250 records. Larger pages reduce round-trips but increase memory footprint per sync worker.

### Parallelism

- **Connector sync workers**: Run up to `min(CPU_CORES, 4)` concurrent syncs. Beyond 4, database connection pool contention dominates.
- **MCP request handling**: Each request is async and non-blocking; the bottleneck is the vector DB. Scale Qdrant horizontally before adding API instances.
- **Fan-out queries** (`Promise.allSettled`): Cap at 10 concurrent sub-queries per MCP tool call to prevent database saturation.

### Caching

- **Semantic cache threshold**: 0.92 similarity — reduce to 0.88 if cache hit rate < 30% on production traffic.
- **Cache TTL**: 5 minutes default. Extend to 15 minutes for read-only analytical queries; keep at 5 minutes for CRM data (changes frequently).
- **Prefix cache**: Keep system-level context (glossary, metric definitions) ≤ 4096 tokens and always prepend it first so Anthropic's prompt cache is warm.

## Baseline Results

*Results are populated automatically by the CI workflow on each load test run.*

| Date | Scenario | RPS | p50 (ms) | p95 (ms) | p99 (ms) | Success % | Pass |
|------|---|---|---|---|---|---|---|
| (pending first CI run) | | | | | | | |

## Alerting

The CI workflow (`load-testing.yml`) runs after every merge and posts a summary comment on the PR.
It fails the check if any threshold is breached, blocking merge until resolved.

Thresholds can be adjusted in `tests/load/load-test-config.ts`.
