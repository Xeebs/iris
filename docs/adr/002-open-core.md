# ADR-002: Open Core Distribution Model

**Status:** Accepted  
**Date:** June 2026  

## Context

Iris needs a distribution model that builds trust with technical buyers (developers evaluating it for internal use), drives community connector contributions, and protects the commercial business.

## Decision

**Open core: MIT license for the connector framework and MCP server core. Closed source for multi-tenancy, advanced caching, enterprise auth, and the admin dashboard.**

Open (MIT):
- `packages/connector-sdk` — BaseConnector, SemanticEntity types
- `packages/connectors/*` — individual connector implementations
- `packages/compression` — context compression pipeline
- `apps/mcp-server` — core MCP server (single-tenant, no auth)

Closed (commercial):
- Multi-tenant workspace isolation
- Semantic cache with vector similarity search
- Admin dashboard
- Role-based context segmentation
- SSO and audit export

## Rationale

- Open connector SDK means external developers can build and publish connectors — this expands the integration marketplace without headcount
- A developer self-hosting the open core validates Iris works before paying; they upgrade for multi-tenancy and managed hosting
- The closed-source components are operational complexity (multi-tenancy, caching, auth) — not differentiated IP that competitors would copy

## Consequences

- GitHub repo is public for open-source packages; closed-source packages live in a private monorepo
- Community PRs to connectors are reviewed and merged; changes to closed packages go through internal review
- Open source license (MIT) must be included in every open package
