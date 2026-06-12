import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MetricRegistry } from '@iris/semantic-core';
import { withResponseCache } from '@iris/cache/response-cache';
import type { ResponseCache } from '@iris/cache/response-cache';

import { registerTool } from '../register-tool.js';

const inputSchema = {
  metricId: z.string().min(1).describe('Metric identifier (e.g., monthly_revenue, churn_rate)'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID for tenant isolation (defaults to the authenticated key\'s workspace)'),
};

/**
 * Register the get-metric tool on an McpServer instance.
 * @param server - MCP server to register on
 * @param metricRegistry - MetricRegistry instance
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 * @param responseCache - Optional response-level cache
 */
export function registerGetMetric(
  server: McpServer,
  metricRegistry: MetricRegistry,
  authenticatedWorkspaceId: string | null = null,
  responseCache: ResponseCache | null = null,
): void {
  registerTool(
    server,
    'get-metric',
    {
      title: 'Get Metric',
      description:
        'Resolve a metric definition. ' +
        'Returns the metric name, formula, and description.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawParams) => {
      const params = rawParams as z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };

      const execute = async () => {
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
      };

      if (responseCache) {
        return withResponseCache('get-metric', params.workspaceId, params as Record<string, unknown>, responseCache, execute);
      }
      return execute();
    },
  );
}
