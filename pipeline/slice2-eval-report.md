# Slice 2 — Retrieval Eval Report

Generated: 2026-06-11T13:30:18.131Z
Workspace: 3ee756ed-26c3-4c08-8029-c6a9f7efde95
Embedding provider: azure

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1946 | 8280 | 76.5% | 508ms | ✓ |
| 2 | What is the largest deal by amount? | 90 | 8280 | 98.9% | 171ms | ✓ |
| 3 | What deals does Globex have? | 1990 | 8280 | 76.0% | 150ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1979 | 8280 | 76.1% | 155ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 1961 | 8280 | 76.3% | 148ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1944 | 8280 | 76.5% | 233ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1979 | 8280 | 76.1% | 157ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1941 | 8280 | 76.6% | 350ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 1950 | 8280 | 76.4% | 183ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 1998 | 8280 | 75.9% | 172ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1975 | 8280 | 76.1% | 159ms | ✓ |
| 12 | What is the second largest deal? | 91 | 8280 | 98.9% | 193ms | ✓ |
| 13 | What is Quantum Systems' industry and number of employees? | 1987 | 8280 | 76.0% | 334ms | ✓ |
| 14 | Which contacts work in New York? | 1953 | 8280 | 76.4% | 173ms | ✓ |
| 15 | How many deals are in the proposal stage? | 2000 | 8280 | 75.8% | 338ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1947 | 8280 | 76.5% | 180ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1954 | 8280 | 76.4% | 246ms | ✓ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1980 | 8280 | 76.1% | 342ms | ✓ |
| 19 | Which companies have more than 200 employees? | 298 | 8280 | 96.4% | 302ms | ✓ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1967 | 8280 | 76.2% | 201ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1948 | 8280 | 76.5% | 171ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 1959 | 8280 | 76.3% | 275ms | ✓ |
| | **Total** | **37837** | **182160** | **79.2%** | p50:183ms p95:350ms | **22/22** |

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
| Query latency p50 | — (measure only) | 183ms | — |
| Query latency p95 | — (measure only) | 350ms | — |

## Debugging Failed Questions

_All questions passed._
