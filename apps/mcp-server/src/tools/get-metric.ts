import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const inputSchema = {
  metricId: z.string().min(1).describe('Metric identifier (e.g., monthly_revenue, churn_rate)'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
};

/**
 * Register the get-metric tool on an McpServer instance.
 * Metrics service is not yet implemented — returns a structured placeholder.
 *
 * @param server - MCP server to register on
 */
export function registerGetMetric(server: McpServer): void {
  server.registerTool(
    'get-metric',
    {
      title: 'Get Metric',
      description:
        'Resolve a metric definition with its current computed value. ' +
        'Returns the metric name, description, current value, and calculation period.',
      inputSchema,
    },
    async (params) => {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Metric "${params.metricId}" is not yet available in workspace ${params.workspaceId}. ` +
              `The metrics service is under development.`,
          },
        ],
      };
    },
  );
}
