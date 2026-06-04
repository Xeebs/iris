# Iris — Business Plan

**Version:** 0.1  
**Date:** June 2026  

---

## 1. Market Opportunity

### Total Addressable Market

The semantic layer and business context AI market is growing rapidly across several converging categories:

- **RAG market:** $1.2B (2024) → $12B projected by 2030 (MarketsandMarkets)
- **Semantic layer tools:** Nascent but accelerating; Gartner placed them in the 2025 Hype Cycle as essential BI/AI infrastructure
- **SMB AI software:** 57% of SMBs now invest in AI (up from 36% in 2023); average SMB AI software spend growing ~30% YoY

**Serviceable Addressable Market (SAM):** US/EU SMB and mid-market companies (10–2,000 employees) actively using AI tools: ~2.5M companies. At $250/month average contract value, that's a $7.5B/year market.

**Serviceable Obtainable Market (SOM — Year 1):** 500 customers × $250/month avg = $1.5M ARR. Conservative. Achievable with a lean team and strong word-of-mouth.

### Why Now

Three forces have converged to make this the right moment to build Iris:

1. **MCP is the emerging standard.** With 97M monthly SDK downloads and support from all major AI providers as of mid-2026, MCP is the integration layer the industry is coalescing around. Building an MCP-native product today means riding this wave, not fighting it.

2. **SMB AI adoption is accelerating, but tools are failing them.** 57% of SMBs invest in AI, but the vast majority are using generic AI tools without business context. The frustration is real and well-documented — and the enterprise solutions (dbt, AtScale, Fabric IQ) are not designed for this segment.

3. **Token costs are a growing pain point.** As AI usage scales, token costs are becoming a meaningful expense for SMBs. A product that demonstrably cuts LLM costs by 50–80% pays for itself immediately.

---

## 2. Business Model

### Pricing Tiers

#### Starter — $149/month
- Up to 3 connectors
- 500K indexed records
- 10K MCP queries/month
- 1 user / 1 AI tool integration
- Community support
- Cloud-hosted only

#### Growth — $399/month *(primary target)*
- Up to 10 connectors
- 5M indexed records
- 100K MCP queries/month
- 10 users / unlimited AI tool integrations
- Business glossary + metric registry
- Email support + onboarding call
- Cloud-hosted

#### Pro — $999/month
- Unlimited connectors
- 50M indexed records
- Unlimited MCP queries
- Unlimited users
- Role-based context segmentation
- Priority support + dedicated CSM
- Self-hosted option (Docker / Helm)

#### Enterprise — Custom
- Volume pricing
- SLA guarantees
- SSO, audit export, compliance controls
- Custom connector development
- On-premise deployment

### Unit Economics (Growth Tier, Target)

| Metric | Value |
|--------|-------|
| MRR per customer | $399 |
| Estimated COGS (infra + support) | ~$80/month |
| Gross margin | ~80% |
| Target CAC (PLG + content) | ~$600 |
| LTV (24-month est.) | ~$9,576 |
| LTV:CAC | ~16:1 |

### Revenue Model Philosophy

Iris is built around a **product-led growth (PLG)** motion:
- Freemium entry point (1 connector, 50K records, 1K queries/month — no credit card)
- Self-serve upgrade when limits are hit
- Human-assisted upgrade for Growth → Pro

Usage-based expansion revenue is natural: as a business adds connectors and query volume grows, they upgrade tiers. This creates strong NRR (net revenue retention) dynamics.

---

## 3. Competitive Positioning

### Position Statement

> For SMB and mid-market operators who use AI tools daily but get inconsistent results because the AI doesn't know their business, Iris is the business context intelligence layer that indexes and governs all their operational data and serves it to any AI tool they use — at a fraction of the token cost of any alternative.

### Competitive Map

```
                    HIGH PRICE / COMPLEXITY
                            │
              AtScale ●     │     ● Microsoft Fabric IQ
              dbt SL ●      │     ● Salesforce Einstein
                            │     ● Databricks
                            │
  NARROW ─────────────────────────────────────────── BROAD
  (one system)              │                   (all systems)
                            │
              Glean ●       │
              Notion AI ●   │      ← IRIS ●
              Vectara ●     │
                            │
                    LOW PRICE / SIMPLICITY
```

### Key Competitive Advantages

1. **MCP-native architecture** — works with the tool businesses already use, vs. requiring a migration
2. **Cross-system semantic index** — the only solution that unifies context across SaaS, warehouse, and docs simultaneously
3. **Token efficiency as a product feature** — measurable ROI that competitors don't surface
4. **SMB-first pricing and UX** — connector setup in 30 minutes vs. weeks of data engineering
5. **Open core** — earns trust with technical evaluators; community-driven connector contributions

---

## 4. Go-to-Market Strategy

### Phase 1: Community and Content (Month 1–4)

**Goal:** Establish Iris as the authoritative voice on "business context for AI" in the SMB/ops community.

- Publish weekly technical content on MCP, token efficiency, and business context architecture (dev.to, Substack, LinkedIn)
- Build in public: share architecture decisions, publish open-source MCP server framework
- Launch on Product Hunt and Hacker News ("Show HN: We built a business context MCP server")
- Seed 10 design partners from personal network (founders, ops managers)

### Phase 2: Product-Led Growth (Month 3–8)

**Goal:** Build a self-serve flywheel from freemium → paid.

- Freemium tier with clear, low-friction upgrade path
- In-product token savings dashboard that shows exactly how much money Iris is saving
- Integration marketplace listing (Claude Marketplace, ChatGPT Plugin Store, etc.)
- Connector contribution program: open source contributors build connectors, Iris hosts and maintains

### Phase 3: Partner-Led (Month 6–12)

**Goal:** Scale through channel partnerships.

- **AI tools:** Partner with Claude for Work, Cursor, and similar tools to be the recommended context layer
- **Consultants & agencies:** White-label/resell program for AI implementation consultants serving SMBs
- **Vertical SaaS:** Embed Iris context into vertical AI products (e.g., legal ops, healthcare admin)

### Sales Motion

- **0–$500/month:** Fully self-serve (no sales touch)
- **$500–$2,000/month:** Sales-assisted (outbound + inbound, short demo, fast close)
- **$2,000+/month:** Enterprise motion (discovery → POC → contract)

---

## 5. Team & Build Plan

### MVP Team (Months 1–4)

| Role | Responsibility |
|------|---------------|
| Founder/CEO | Product, GTM, fundraising |
| Founding Engineer | MCP server, connector framework, API |
| (Contractor) | Dashboard UI, connector UI |

### Hiring Roadmap (Post-Seed)

- **Month 5:** Second engineer (connector specialist)
- **Month 7:** Growth / DevRel hire
- **Month 10:** Customer Success Manager

### Build with Claude Code

The project is designed to be developed primarily with Claude Code, using the project directory structure defined in this repo. Claude Code will be used for:
- Connector scaffolding and boilerplate generation
- Test generation for each connector
- MCP tool and resource definitions
- Context compression pipeline implementation

---

## 6. Financial Projections

### Conservative Case (Year 1)

| Month | Customers | MRR | ARR Run Rate |
|-------|-----------|-----|--------------|
| 3 | 10 | $2,490 | $29,880 |
| 6 | 50 | $14,950 | $179,400 |
| 9 | 150 | $44,850 | $538,200 |
| 12 | 350 | $104,650 | $1,255,800 |

*Assumes avg contract ~$299/month blended across tiers*

### Funding Plan

**Pre-Seed:** $500K–$750K (angel / pre-seed fund)
- 18-month runway at lean burn (~$40K/month)
- Fund: MVP build, first 2 engineers, GTM experiments

**Seed:** $2M–$4M (target: Month 12–15, at $1.25M ARR run rate)
- Fund: Team growth, connector marketplace, enterprise features

---

## 7. Key Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MCP doesn't win as the standard | Low (all major providers committed) | High | Build abstraction layer; support REST fallback |
| Enterprise semantic layer players move down-market | Medium | High | Speed of execution; SMB UX moat; open core community |
| Token costs drop to zero (LLM commoditization) | Low (medium-term) | Medium | Pivot value prop to accuracy and governance, not just cost |
| Data security / privacy concern blocks SMB adoption | Medium | Medium | SOC 2 Type II certification in Year 1; on-prem option |
| Connector maintenance becomes overwhelming | High | Medium | Open source connector framework; community contributions |

---

## 8. Open Source Strategy

Iris follows an **open core model:**

- **Open source (MIT):** MCP server framework, connector SDK, compression utilities
- **Closed source / hosted:** Multi-tenancy, advanced caching, admin dashboard, enterprise auth

**Why open core for this market:**
- Technical buyers (developers building internal agents) want to inspect and trust the code
- Connector contributions from the community accelerate the marketplace
- OSS distribution channels (GitHub, Hacker News, dev.to) are the most cost-effective GTM for developer-adjacent products
- Creates a moat: even if a large vendor copies the concept, Iris's community and connector ecosystem is the defensible asset
