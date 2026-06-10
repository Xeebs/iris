import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

/**
 * Tool registration config — the subset of the SDK's config we use, with the
 * input schema typed as a plain zod raw shape instead of the SDK's generics.
 */
export type CheapToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
};

/**
 * Tool handler over untyped input. Call sites narrow `input` themselves
 * (typically `input as z.infer<...>` or an explicit input type) — the SDK has
 * already validated it against `inputSchema` before the handler runs.
 */
export type CheapToolHandler = (input: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

type CheapRegisterTool = (name: string, config: CheapToolConfig, handler: CheapToolHandler) => void;

/**
 * Register an MCP tool through a fixed, non-generic signature.
 *
 * The SDK's `tool()` / `registerTool()` generics instantiate the entire
 * zod v3 + v4 dual type surface per call site (SDK 1.29 × zod 3.25.x), which
 * drives `tsc` past 4 GB of heap and aborts the build/typecheck with OOM —
 * a single generic call takes minutes to check (TS2589 at best). Casting the
 * method to a concrete signature skips that instantiation entirely while
 * being behaviorally identical at runtime: the SDK introspects the zod shape
 * values, not the static types.
 *
 * Always register tools through this helper — never call `server.tool()` or
 * `server.registerTool()` directly.
 *
 * @param server - The McpServer to register on
 * @param name - Tool name (kebab-case)
 * @param config - Title, description, and zod raw-shape input schema
 * @param handler - Tool handler; receives SDK-validated input as a plain record
 * @returns void
 */
export function registerTool(
  server: McpServer,
  name: string,
  config: CheapToolConfig,
  handler: CheapToolHandler,
): void {
  (server.registerTool as unknown as CheapRegisterTool).call(server, name, config, handler);
}
