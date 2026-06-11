# Slice 2 — Retrieval Eval Report

Generated: 2026-06-11T06:00:15.369Z
Workspace: 8c527d5f-087c-4579-a3e1-99792fecd05e
Embedding provider: azure

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1990 | 8280 | 76.0% | 512ms | ✓ |
| 2 | What is the largest deal by amount? | 90 | 8280 | 98.9% | 336ms | ✓ |
| 3 | What deals does Globex have? | 1990 | 8280 | 76.0% | 188ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1979 | 8280 | 76.1% | 219ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 1961 | 8280 | 76.3% | 206ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1944 | 8280 | 76.5% | 209ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1979 | 8280 | 76.1% | 139ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1941 | 8280 | 76.6% | 243ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 1950 | 8280 | 76.4% | 219ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 1998 | 8280 | 75.9% | 180ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1975 | 8280 | 76.1% | 133ms | ✓ |
| 12 | What is the second largest deal? | 91 | 8280 | 98.9% | 162ms | ✓ |
| 13 | What is Quantum Systems' industry and number of employees? | 1987 | 8280 | 76.0% | 179ms | ✓ |
| 14 | Which contacts work in New York? | 1953 | 8280 | 76.4% | 132ms | ✓ |
| 15 | How many deals are in the proposal stage? | 2000 | 8280 | 75.8% | 297ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1947 | 8280 | 76.5% | 173ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1954 | 8280 | 76.4% | 168ms | ✓ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1980 | 8280 | 76.1% | 322ms | ✓ |
| 19 | Which companies have more than 200 employees? | 298 | 8280 | 96.4% | 177ms | ✓ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1967 | 8280 | 76.2% | 221ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1948 | 8280 | 76.5% | 154ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 1959 | 8280 | 76.3% | 159ms | ✓ |
| | **Total** | **37881** | **182160** | **79.2%** | p50:180ms p95:336ms | **22/22** |

## Category Breakdown

- **relationship**: 4/4 passed
- **aggregate_superlative**: 4/4 passed
- **aggregate_count**: 2/2 passed
- **filter**: 6/6 passed
- **entity_lookup**: 6/6 passed

## Thresholds

| Metric | Required | Actual | Status |
|--------|----------|--------|--------|
| Accuracy | ≥ 90% | 100.0% | ✓ MET |
| Token savings | ≥ 70% | 79.2% | ✓ MET |
| Query latency p50 | — (measure only) | 180ms | — |
| Query latency p95 | — (measure only) | 336ms | — |

## Debugging Failed Questions

_All questions passed._
