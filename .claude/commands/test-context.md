# /project:test-context

Test a natural language query against the Iris MCP server and inspect the context response.

## Usage

```
/project:test-context "<query>"
```

Example: `/project:test-context "What are our top 5 deals by value?"`

## Instructions for Claude Code

When executing this command:

1. Ensure the MCP server is running (`pnpm mcp:start`)
2. Send the query to the local MCP server via the `query-context` tool
3. Display:
   - The returned context (formatted, with entity highlights)
   - Token count of the response
   - Cache status (hit / miss)
   - Sources used (which connectors contributed context)
   - Estimated token cost vs. naive full-context injection (savings %)
4. Optionally suggest follow-up queries to explore related context
