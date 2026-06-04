# ADR-001: MCP as the Primary AI Integration Interface

**Status:** Accepted  
**Date:** June 2026  

## Context

Iris needs to serve business context to AI tools. The options are:
1. Custom REST API per AI tool (OpenAI plugin format, Claude tool use, etc.)
2. LangChain / LlamaIndex integration packages
3. MCP (Model Context Protocol) — open standard now backed by Anthropic, OpenAI, Google, Microsoft

## Decision

**All AI tool integration goes through the MCP server.** No tool-specific SDKs or custom API formats.

## Rationale

- MCP has 97M monthly downloads and support from every major AI provider as of mid-2026
- Open standard donated to Linux Foundation — not controlled by a single vendor
- One implementation serves Claude, ChatGPT, Copilot, Cursor, and every future tool that adopts MCP
- The MCP tool/resource abstraction maps naturally to Iris's semantic entities and query patterns
- MCP Inspector exists for local debugging; no custom tooling needed

## Consequences

- Claude Code clients and other AI tools can be pointed to the Iris MCP server URL with no other configuration
- If MCP loses momentum, we need an adapter layer — mitigation: keep the context engine decoupled from the transport layer so we can add REST/GraphQL outputs later
- All new AI tool integrations are zero-code on our side — they implement MCP, they get Iris for free
