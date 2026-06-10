# Vertical Slice — Token Savings Report

Generated: 2026-06-10T22:33:01.187Z
Workspace: 9e484221-eb93-4674-b324-af8859f78731

Baseline = estimated tokens of the raw HubSpot fixture JSON a user would
paste to answer each question. Iris = `query-context` response tokens
(contextBudget 2000). Both use the shared length/4 estimator.

| # | Question | Iris tokens | Raw-paste tokens | Savings |
|---|----------|-------------|------------------|---------|
| 1 | How many open deals do we have, and what is their total value? | 217 | 932 | 76.7% |
| 2 | Which company does Alice Smith work for? | 80 | 1259 | 93.6% |
| 3 | List our deals in the negotiation stage. | 217 | 932 | 76.7% |
| 4 | Who is the owner of our largest deal? | 624 | 932 | 33.0% |
| 5 | Which contacts belong to Acme Corp? | 115 | 1259 | 90.9% |
| | **Total** | **1253** | **5314** | **76.4%** |

Required savings: ≥ 70% — MET
