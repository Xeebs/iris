# Slice 2 — Retrieval Eval Report

Generated: 2026-06-11T06:45:38.733Z
Workspace: da84c45a-1c60-4b87-8159-13a07bb9b9f8
Embedding provider: azure

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1946 | 8280 | 76.5% | 451ms | ✓ |
| 2 | What is the largest deal by amount? | 90 | 8280 | 98.9% | 244ms | ✓ |
| 3 | What deals does Globex have? | 1990 | 8280 | 76.0% | 124ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1979 | 8280 | 76.1% | 235ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 1952 | 8280 | 76.4% | 120ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1944 | 8280 | 76.5% | 641ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1979 | 8280 | 76.1% | 186ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1941 | 8280 | 76.6% | 225ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 1950 | 8280 | 76.4% | 183ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 1998 | 8280 | 75.9% | 218ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1975 | 8280 | 76.1% | 147ms | ✓ |
| 12 | What is the second largest deal? | 91 | 8280 | 98.9% | 157ms | ✓ |
| 13 | What is Quantum Systems' industry and number of employees? | 1987 | 8280 | 76.0% | 127ms | ✓ |
| 14 | Which contacts work in New York? | 1953 | 8280 | 76.4% | 142ms | ✓ |
| 15 | How many deals are in the proposal stage? | 2000 | 8280 | 75.8% | 164ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1947 | 8280 | 76.5% | 192ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1921 | 8280 | 76.8% | 155ms | ✓ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1980 | 8280 | 76.1% | 187ms | ✓ |
| 19 | Which companies have more than 200 employees? | 298 | 8280 | 96.4% | 145ms | ✓ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1967 | 8280 | 76.2% | 215ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1948 | 8280 | 76.5% | 234ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 1961 | 8280 | 76.3% | 237ms | ✓ |
| | **Total** | **37797** | **182160** | **79.3%** | p50:186ms p95:451ms | **22/22** |

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
| Token savings | ≥ 70% | 79.3% | ✓ MET |
| Query latency p50 | — (measure only) | 186ms | — |
| Query latency p95 | — (measure only) | 451ms | — |

## Debugging Failed Questions

_All questions passed._
