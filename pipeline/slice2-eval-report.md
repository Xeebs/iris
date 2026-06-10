# Slice 2 — Retrieval Eval Report

Generated: 2026-06-10T22:36:22.141Z
Workspace: 02b0f4a1-f1a9-4ea0-85ea-bad7cef42476
Embedding provider: ollama

Baseline = estimated tokens of the full iris_demo_source dump a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Baseline | Savings | Latency | Pass |
|---|----------|-------------|----------|---------|---------|------|
| 1 | Who are the contacts at Acme Corp? | 1146 | 8280 | 86.2% | 26273ms | ✗ |
| 2 | What is the largest deal by amount? | 1993 | 8280 | 75.9% | 25598ms | ✓ |
| 3 | What deals does Globex have? | 1819 | 8280 | 78.0% | 103ms | ✓ |
| 4 | How many contacts are in the customer stage? | 1196 | 8280 | 85.6% | 116ms | ✓ |
| 5 | What is Alice Johnson's title and company? | 627 | 8280 | 92.4% | 79ms | ✓ |
| 6 | Which deals are currently in the negotiation stage? | 1981 | 8280 | 76.1% | 111ms | ✓ |
| 7 | Who owns the Globex Enterprise Platform deal? | 1964 | 8280 | 76.3% | 95ms | ✓ |
| 8 | What is the total value of all closed_won deals? | 1983 | 8280 | 76.1% | 83ms | ✓ |
| 9 | What companies are in the Manufacturing industry? | 492 | 8280 | 94.1% | 85ms | ✓ |
| 10 | What is Bob Chen's title and what company does he work at? | 540 | 8280 | 93.5% | 86ms | ✓ |
| 11 | Which deals does Sarah Kim own? | 1942 | 8280 | 76.5% | 78ms | ✓ |
| 12 | What is the second largest deal? | 1965 | 8280 | 76.3% | 82ms | ✗ |
| 13 | What is Quantum Systems' industry and number of employees? | 592 | 8280 | 92.9% | 71ms | ✓ |
| 14 | Which contacts work in New York? | 903 | 8280 | 89.1% | 102ms | ✓ |
| 15 | How many deals are in the proposal stage? | 1941 | 8280 | 76.6% | 76ms | ✓ |
| 16 | What deals does Zenith Capital have and what are their amoun | 1829 | 8280 | 77.9% | 83ms | ✓ |
| 17 | Who are the contacts at Forge Manufacturing and what are the | 1198 | 8280 | 85.5% | 78ms | ✗ |
| 18 | What is the Quantum Security Platform deal worth and what st | 1958 | 8280 | 76.4% | 96ms | ✓ |
| 19 | Which companies have more than 200 employees? | 485 | 8280 | 94.1% | 77ms | ✗ |
| 20 | What is the BlueSky MES Upgrade deal amount and who owns it? | 1870 | 8280 | 77.4% | 85ms | ✓ |
| 21 | What deals has Tom Garcia closed? | 1981 | 8280 | 76.1% | 83ms | ✓ |
| 22 | Which companies are in the Finance or Financial Services ind | 492 | 8280 | 94.1% | 87ms | ✓ |
| | **Total** | **30897** | **182160** | **83.0%** | p50:85ms p95:25598ms | **18/22** |

## Category Breakdown

- **relationship**: 2/4 passed
- **aggregate_superlative**: 2/4 passed
- **aggregate_count**: 2/2 passed
- **filter**: 6/6 passed
- **entity_lookup**: 6/6 passed

## Thresholds

| Metric | Required | Actual | Status |
|--------|----------|--------|--------|
| Accuracy | ≥ 90% | 81.8% | ✗ NOT MET |
| Token savings | ≥ 70% | 83.0% | ✓ MET |
| Query latency p50 | — (measure only) | 85ms | — |
| Query latency p95 | — (measure only) | 25598ms | — |
