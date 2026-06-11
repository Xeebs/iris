# Slice 2 — Retrieval Eval Report

Generated: 2026-06-11T05:08:07.910Z
Workspace: a9e7a0c0-730b-48d8-948c-879899d680c2
Embedding provider: ollama

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1993 | 8280 | 75.9% | 167ms | ✓ |
| 2 | What is the largest deal by amount? | 90 | 8280 | 98.9% | 102ms | ✓ |
| 3 | What deals does Globex have? | 1982 | 8280 | 76.1% | 99ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1947 | 8280 | 76.5% | 176ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 1987 | 8280 | 76.0% | 87ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1997 | 8280 | 75.9% | 90ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1981 | 8280 | 76.1% | 96ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1991 | 8280 | 76.0% | 90ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 1949 | 8280 | 76.5% | 89ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 1993 | 8280 | 75.9% | 89ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1981 | 8280 | 76.1% | 159ms | ✓ |
| 12 | What is the second largest deal? | 91 | 8280 | 98.9% | 93ms | ✓ |
| 13 | What is Quantum Systems' industry and number of employees? | 1986 | 8280 | 76.0% | 80ms | ✓ |
| 14 | Which contacts work in New York? | 1928 | 8280 | 76.7% | 80ms | ✓ |
| 15 | How many deals are in the proposal stage? | 1952 | 8280 | 76.4% | 85ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1991 | 8280 | 76.0% | 118ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1967 | 8280 | 76.2% | 117ms | ✓ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1981 | 8280 | 76.1% | 107ms | ✓ |
| 19 | Which companies have more than 200 employees? | 298 | 8280 | 96.4% | 77ms | ✓ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1981 | 8280 | 76.1% | 88ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1988 | 8280 | 76.0% | 103ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 1953 | 8280 | 76.4% | 84ms | ✓ |
| | **Total** | **38007** | **182160** | **79.1%** | p50:90ms p95:167ms | **22/22** |

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
| Token savings | ≥ 70% | 79.1% | ✓ MET |
| Query latency p50 | — (measure only) | 90ms | — |
| Query latency p95 | — (measure only) | 167ms | — |

## Debugging Failed Questions

_All questions passed._
