# Slice 2 — Retrieval Eval Report

Generated: 2026-06-11T22:42:09.174Z
Workspace: 3d662c50-d108-4cc3-b68f-d0d271eefc2d
Embedding provider: azure

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1946 | 8280 | 76.5% | 358ms | ✓ |
| 2 | What is the largest deal by amount? | 90 | 8280 | 98.9% | 169ms | ✓ |
| 3 | What deals does Globex have? | 1990 | 8280 | 76.0% | 146ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1979 | 8280 | 76.1% | 209ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 1961 | 8280 | 76.3% | 182ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1944 | 8280 | 76.5% | 223ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1979 | 8280 | 76.1% | 221ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1941 | 8280 | 76.6% | 162ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 1950 | 8280 | 76.4% | 169ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 1998 | 8280 | 75.9% | 174ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1975 | 8280 | 76.1% | 174ms | ✓ |
| 12 | What is the second largest deal? | 91 | 8280 | 98.9% | 187ms | ✓ |
| 13 | What is Quantum Systems' industry and number of employees? | 1987 | 8280 | 76.0% | 134ms | ✓ |
| 14 | Which contacts work in New York? | 1953 | 8280 | 76.4% | 181ms | ✓ |
| 15 | How many deals are in the proposal stage? | 2000 | 8280 | 75.8% | 219ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1947 | 8280 | 76.5% | 218ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1954 | 8280 | 76.4% | 491ms | ✓ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1980 | 8280 | 76.1% | 198ms | ✓ |
| 19 | Which companies have more than 200 employees? | 298 | 8280 | 96.4% | 158ms | ✓ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1967 | 8280 | 76.2% | 208ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1948 | 8280 | 76.5% | 146ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 1959 | 8280 | 76.3% | 181ms | ✓ |
| | **Total** | **37837** | **182160** | **79.2%** | p50:181ms p95:358ms | **22/22** |

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
| Query latency p50 | — (measure only) | 181ms | — |
| Query latency p95 | — (measure only) | 358ms | — |

## Debugging Failed Questions

_All questions passed._
