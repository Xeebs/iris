# Iris — Product Requirements Document

**Version:** 0.1 (Draft)  
**Date:** June 2026  
**Status:** Pre-Seed / Discovery  

---

## 1. Executive Summary

Iris is a platform-agnostic business context intelligence layer that indexes, semantically enriches, and efficiently serves an organization's operational data to any AI tool the business already uses — without requiring a data engineering team, a data warehouse, or a six-figure enterprise contract.

The core value proposition is **token-efficient, governed business context delivered via the Model Context Protocol (MCP)** to any AI platform (Claude, ChatGPT, Copilot, custom agents), dramatically reducing the cost and hallucination rate of AI usage while requiring no changes to existing workflows or AI tools.

Target market: SMB and mid-market companies (10–2,000 employees) that are actively using AI tools but getting inconsistent, expensive, or unreliable results due to lack of structured business context.

---

## 2. Problem Statement

### 2.1 The Core Pain

AI tools are now ubiquitous in business — but they're generic. When a sales rep asks Claude "What's our average deal size for Q1?" or an ops manager asks "Which suppliers are on 90-day terms?", the AI has no idea what that business's data looks like. The workaround today is:

- Manually pasting data into prompts (expensive tokens, no governance, copy-paste errors)
- Building custom RAG pipelines (requires engineers, ongoing maintenance)
- Buying enterprise semantic layer tools (designed for data teams, $30K+/year minimum)
- Staying locked in a single vendor ecosystem (Microsoft Fabric IQ, Salesforce Einstein, etc.)

### 2.2 The Token Problem

Multi-agent AI systems consume 4–15× more tokens than single calls when unoptimized. A typical agentic workflow that re-sends full business context with each reasoning step can consume 15,000+ tokens per query. For a 50-person company running dozens of AI queries daily, this becomes a significant and growing cost center.

### 2.3 The Fragmentation Problem

The average SMB runs 40+ SaaS applications. Business context is scattered across a CRM, a project management tool, a data warehouse or spreadsheets, a knowledge base, and financial software. No existing tool provides a unified semantic overlay across all of these — especially not at SMB price points.

### 2.4 The Vendor Lock-In Problem

Microsoft Fabric IQ, Salesforce Einstein, and similar offerings solve the semantic layer problem only within their own ecosystem. A company running HubSpot, Notion, Snowflake, and NetSuite gets no benefit from any of these solutions without migrating to a single vendor's stack.

---

## 3. Market Research & Competitive Landscape

### 3.1 Existing Solution Categories

#### Semantic Layer Tools (Data-Warehouse Native)
| Tool | Pricing | Target | Key Limitation for SMB |
|------|---------|--------|------------------------|
| **dbt Semantic Layer** | Included in dbt Cloud Team/Enterprise | Data engineers | Requires dbt Cloud subscription + existing warehouse |
| **Cube.dev** | Open source + Cube Cloud paid | Developer teams | Requires self-hosted server infrastructure |
| **AtScale** | $2,500+/month | Enterprise data teams | Enterprise complexity and pricing |
| **Omni Analytics** | Undisclosed (enterprise) | BI teams | BI-centric, not AI-agent-first |

**Key gap:** All assume you have a data warehouse. All require technical implementation. None are designed for the business user or the SMB operator.

#### RAG / Enterprise Context Platforms
| Tool | Pricing | Target | Key Limitation |
|------|---------|--------|----------------|
| **LlamaIndex** | Open source | Developers | DIY assembly, no semantic governance |
| **LangChain** | Open source | Developers | Framework, not a product |
| **Vectara** | $50/month+ | Developers | Document retrieval only, no operational data |
| **Glean** | Enterprise ($) | Enterprise knowledge search | Document/communication search only |
| **Notion AI** | $10/user/month add-on | Notion users | Locked to Notion content |

**Key gap:** RAG platforms retrieve documents — they don't understand or govern operational/transactional data (pipeline stages, customer contracts, supplier terms, etc.).

#### Vendor-Specific Semantic AI
| Tool | Ecosystem | Key Limitation |
|------|-----------|----------------|
| **Microsoft Fabric IQ** | Microsoft Fabric / OneLake | Requires full Microsoft stack |
| **Salesforce Einstein** | Salesforce CRM | CRM data only |
| **Databricks AI/BI** | Databricks platform | Data engineering teams |
| **Looker (Google)** | BigQuery-native | Requires Looker + BigQuery |

**Key gap:** Every solution is designed to keep you on a single vendor's platform. Cross-system semantic context doesn't exist in any of these products.

### 3.2 The MCP Opportunity

The Model Context Protocol (MCP) has emerged as the USB-C of AI tool integration. By June 2026:
- 97M monthly SDK downloads
- 10,000+ active public MCP servers
- All major AI platforms support it (Claude, OpenAI, Gemini, Copilot)
- Donated to Linux Foundation; fully open standard

**No company has built an MCP server that acts as a pre-indexed, semantically enriched, token-compressed business context hub.** Most MCP servers are thin connectors to individual APIs — they don't do indexing, compression, governance, or semantic enrichment. This is the exact whitespace Iris occupies.

---

## 4. Identified Gaps & Differentiation Opportunities

| Gap | Current State | Iris Opportunity |
|-----|--------------|------------------|
| **SMB access** | All semantic layer tools are enterprise-priced or require a data team | Self-serve SaaS, no data engineers needed |
| **Cross-system context** | Each vendor solves for their own ecosystem only | Unified semantic index across all primary business systems |
| **Non-warehouse data** | Semantic layers assume a warehouse | Connect to SaaS APIs directly (HubSpot, Notion, Airtable, etc.) |
| **Token efficiency** | Raw context passed to LLMs repeatedly | Pre-compressed, cached, governance-filtered context |
| **AI-platform agnosticism** | Vendor-specific implementations | MCP-native, works with any LLM |
| **Business user friendly** | All tools require engineers | No-code connector setup, business-friendly UI |
| **Semantic + operational** | RAG = documents; semantic layers = warehouse metrics | Unified layer over both structured data AND unstructured knowledge |

---

## 5. Solution Overview

### 5.1 What Iris Is

Iris is a **business context intelligence server** that:

1. **Connects** to a business's primary systems (CRM, data warehouse, docs, ERP, project tools) via pre-built connectors
2. **Indexes** that data into a semantic graph — understanding entity relationships, metric definitions, and business terminology
3. **Compresses** context intelligently so only what's needed for a given query is surfaced, not everything
4. **Serves** this context via MCP to any AI tool the business already uses
5. **Governs** what context is accessible to which users/agents, with full audit trails

The result: an employee asking Claude "What's the margin on our top 10 accounts?" gets an accurate, governed answer instantly — without the AI needing to know anything about that company's data schema, and without that query consuming thousands of unnecessary tokens.

### 5.2 Core Mental Model

> Iris is the semantic memory of your business, plugged into every AI tool you use.

Where a human employee learns over time what "ARR", "churn", and "tier-1 account" mean at their specific company — Iris encodes that institutional knowledge once and serves it to every AI agent, on demand, efficiently.

### 5.3 Key Differentiators

- **MCP-native from day one** — works with Claude, ChatGPT, Copilot, Cursor, and any future AI tool that adopts MCP
- **Token efficiency as a first-class feature** — semantic caching, prompt prefix optimization, and context compression reduce LLM costs by an estimated 50–80%
- **No warehouse required** — connects to SaaS APIs directly
- **Business-user setup** — connector setup in under 30 minutes, no SQL or data engineering required
- **Open core** — self-hosted option for compliance-sensitive mid-market customers

---

## 6. Feature Requirements

### 6.1 MVP (v0.1)

#### Connector Framework
- [ ] Pre-built connectors for: HubSpot, Salesforce, Notion, Google Drive, Snowflake, PostgreSQL
- [ ] Connector configuration UI (OAuth flows, field mapping)
- [ ] Incremental sync with configurable frequency (real-time, hourly, daily)
- [ ] Schema auto-discovery with human-in-the-loop confirmation

#### Semantic Index
- [ ] Entity extraction and relationship mapping across sources
- [ ] Business terminology dictionary (user-defined glossary)
- [ ] Metric definition registry (e.g., "ARR = sum of active MRR × 12")
- [ ] Vector embeddings for semantic search over indexed content

#### Context Server (MCP)
- [ ] MCP-compliant server exposing indexed context as tools and resources
- [ ] Query-time context retrieval with semantic relevance scoring
- [ ] Context budget enforcement (max tokens per query, configurable)
- [ ] Audit log of all context reads by user/agent

#### Token Efficiency Engine
- [ ] Semantic deduplication of ingested content
- [ ] Prompt prefix caching for system context (leveraging Anthropic/OpenAI provider caching)
- [ ] Semantic response cache (vector similarity matching for repeated queries)
- [ ] Context compression pipeline (summarization → structured extraction → token budget)

#### Admin Dashboard
- [ ] Connector health monitoring
- [ ] Token usage analytics (saved vs. spent)
- [ ] User/agent access control
- [ ] Index status and coverage metrics

### 6.2 V1 (Post-MVP)

- [ ] Additional connectors: Airtable, Confluence, Jira, NetSuite, QuickBooks, Slack, Linear
- [ ] Knowledge graph visualization (explore entity relationships)
- [ ] Business glossary sharing across team members
- [ ] Multi-tenant support (for agencies or businesses with subsidiaries)
- [ ] OSI (Open Semantic Interchange) standard export
- [ ] Webhook-driven real-time sync
- [ ] Role-based context segmentation (sales sees sales context, finance sees finance context)

### 6.3 V2

- [ ] Proactive context surfacing (push relevant context to AI agents before they ask)
- [ ] Cross-company benchmarking (anonymized, opt-in)
- [ ] Natural language index configuration ("our fiscal year starts in February")
- [ ] Agent workflow templates pre-configured with Iris context
- [ ] Fine-grained PII/sensitive field masking

---

## 7. Token Efficiency Architecture

Iris implements a four-layer efficiency stack:

### Layer 1: Index-Time Compression
- **Semantic deduplication:** Embeddings-based clustering removes redundant content before it enters the index (cosine similarity threshold: 0.85)
- **Structured extraction:** Raw records are transformed into compact semantic representations (e.g., a 2KB CRM record becomes a 200-token structured entity)
- **Relationship graph:** Entity relationships are stored as graph edges, not repeated in each record's text

### Layer 2: Retrieval-Time Filtering
- **Query decomposition:** Incoming AI queries are analyzed to determine which entity types and data domains are relevant
- **Relevance scoring:** Only top-k semantically relevant context chunks are returned (configurable k, default: 5)
- **Context budget:** Hard token cap per MCP request, configurable per user/agent/tool

### Layer 3: Caching
- **Provider prefix caching:** Static system context (glossary, metric definitions, schema) is structured to maximize prefix cache hits (Anthropic: 90% cost reduction on cached prefixes)
- **Semantic response cache:** Vector-matched query cache returns stored answers for semantically equivalent queries without LLM re-inference
- **TTL management:** Cache invalidation tied to source data change events, not wall-clock time

### Layer 4: Delivery Optimization
- **Progressive context:** Serve minimal context first; agents can request expansion if needed
- **Format optimization:** Structured JSON context delivered in the most token-efficient serialization format per LLM provider
- **Differential updates:** When context changes, serve only the delta vs. a known baseline

**Estimated aggregate savings: 50–80% token reduction vs. naive full-context injection**, based on published benchmarks for individual techniques.

---

## 8. Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Tools Layer                        │
│   Claude  │  ChatGPT  │  Copilot  │  Cursor  │  Custom Agents│
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP (standard protocol)
┌───────────────────────────▼─────────────────────────────────┐
│                     Iris MCP Server                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │Context Query│  │ Access Control│  │ Audit & Governance │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Context Engine                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  Retrieval   │  │  Compression  │  │  Cache Manager   │  │
│  │  (vector +   │  │  Pipeline     │  │  (semantic +     │  │
│  │   graph)     │  │               │  │   prefix)        │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Semantic Index                             │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Entity    │  │  Metric      │  │  Business            │ │
│  │  Graph     │  │  Registry    │  │  Glossary            │ │
│  └────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           Vector Store (pgvector / Qdrant)           │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    Connector Layer                            │
│  HubSpot │ Salesforce │ Notion │ Snowflake │ Postgres │ ...  │
└─────────────────────────────────────────────────────────────┘
```

### Core Tech Stack (Recommended)
- **Runtime:** Node.js 20+ (TypeScript throughout — no Python; single runtime for consistency)
- **MCP SDK:** Official Anthropic MCP TypeScript or Python SDK
- **Vector store:** pgvector (embedded) or Qdrant (self-hosted)
- **Graph store:** Neo4j Community (self-hosted) or ArangoDB
- **Cache:** Redis (semantic cache + session)
- **Queue:** BullMQ (sync jobs)
- **Auth:** Clerk or Auth0 (OAuth flows for connectors)
- **Dashboard:** Next.js + shadcn/ui

---

## 9. Target Users & Personas

### Primary: The Ops-Aware Founder / COO (SMB)
- 20–150 person company
- Uses AI tools daily (Claude, ChatGPT) for operational questions
- Frustrated that AI "doesn't know their business"
- No data team; some technical literacy
- Willing to pay $200–500/month to save hours of manual context prep

### Secondary: The RevOps / BizOps Manager (Mid-Market)
- 150–2,000 person company
- Responsible for making AI tools actually useful for the team
- Has a basic data stack (a warehouse, a BI tool, a CRM)
- Measures ROI on AI in terms of time saved and accuracy
- Manages a small team; influences $10K–50K/year software budgets

### Tertiary: The Developer / AI Engineer (Technical Buyer)
- Building internal AI agents or tools for the business
- Wants a battle-hardened context server they don't have to build from scratch
- Values open source, good APIs, and extensibility
- Will self-host if needed

---

## 10. Success Metrics

### MVP Launch KPIs
- 50 active paying customers within 90 days of launch
- Average token reduction vs. baseline: ≥50%
- Connector setup time: ≤30 minutes (measured via onboarding flow)
- MCP query latency p95: ≤200ms (cache hit) / ≤2s (cache miss)
- NPS ≥ 50 from early cohort

### 12-Month KPIs
- 500 paying customers
- $1.25M ARR run rate (aligns with revenue model: ~350 customers × $299 blended avg at month 12)
- 10 production-ready connectors
- Zero critical data governance incidents

---

## 11. Roadmap

### Phase 0: Foundation (Month 1–2)
- Core MCP server scaffold
- Connector framework + 2 connectors (HubSpot, Notion)
- Basic semantic index (vector search, entity extraction)
- Admin dashboard (connector health, query log)
- Token efficiency: provider prefix caching

### Phase 1: MVP (Month 3–4)
- 4 additional connectors (Salesforce, Snowflake, Postgres, Google Drive)
- Business glossary + metric registry
- Semantic response cache
- Context compression pipeline
- Public beta launch

### Phase 2: Growth (Month 5–8)
- 6 more connectors (Airtable, Jira, Confluence, NetSuite, Slack, Linear)
- Role-based context segmentation
- Knowledge graph visualization
- OSI standard export
- Self-hosted deployment option (Docker / Helm chart)

### Phase 3: Scale (Month 9–12)
- Multi-tenant / white-label support
- Proactive context surfacing
- Agent workflow templates
- Enterprise features (SSO, audit export, SLA)
