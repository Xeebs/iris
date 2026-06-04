/**
 * Iris MCP Server — Entry Point
 *
 * Exposes business context as MCP tools and resources.
 * AI tools (Claude, ChatGPT, Copilot, etc.) connect here via MCP
 * to retrieve governed, token-efficient business context.
 *
 * Tools exposed:
 *   - query-context       Query the semantic index with natural language
 *   - list-entities       List entities of a given type
 *   - get-entity          Get a specific entity by ID
 *   - get-metric          Resolve a metric definition with current value
 *   - list-glossary       Return business terminology definitions
 *
 * @see docs/architecture.md
 */

// TODO: Initialize MCP server using @modelcontextprotocol/sdk
// import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  // TODO: Initialize services (semantic index, cache, audit logger)
  // TODO: Register MCP tools (see apps/mcp-server/src/tools/)
  // TODO: Register MCP resources (see apps/mcp-server/src/resources/)
  // TODO: Start server on stdio or HTTP transport

  console.log('Iris MCP Server starting...');
  console.log('TODO: Implement server initialization');
}

main().catch(console.error);
