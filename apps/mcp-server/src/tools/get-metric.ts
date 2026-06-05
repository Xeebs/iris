import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MetricRegistry } from '@iris/semantic-core';

const inputSchema = {
  metricId: z.string().min(1).describe('Metric identifier (e.g., monthly_revenue, churn_rate)'),
  workspaceId: z.string().min(1).describe('Workspace ID for tenant isolation'),
};

/**
 * Register the get-metric tool on an McpServer instance.
 * @param server - MCP server to register on
 * @param metricRegistry - MetricRegistry instance
 */
export function registerGetMetric(server: McpServer, metricRegistry: MetricRegistry): void {
  server.registerTool(
    'get-metric',
    {
      title: 'Get Metric',
      description:
        'Resolve a metric definition. ' +
        'Returns the metric name, formula, and description.',
      inputSchema,
    },
    async (params) => {
      const result = await metricRegistry.getMetric(params.workspaceId, params.metricId);
      if (result.isErr()) {
        return {
          content: [{ type: 'text' as const, text: `Error retrieving metric "${params.metricId}": ${result.error.message}` }],
        };
      }
      const metric = result.value;
      if (!metric) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Metric "${params.metricId}" is not defined for workspace ${params.workspaceId}. Define it via POST /api/v1/metrics.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Metric: ${metric.name}\nFormula: ${metric.formula}\nDescription: ${metric.description}`,
          },
        ],
      };
    },
  );
}
