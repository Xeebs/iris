import { z } from 'zod';
import type { Sql } from 'postgres';
import {
  MultiConnectorQueryOptimizer,
  type ConnectorMeta,
} from '@iris/semantic-core/multi-connector-optimizer';
import { logger } from '@iris/core/logger';

const InputSchema = z.object({
  query: z.string().min(1).describe('The user query or business question to optimize'),
  connectors: z.array(z.object({
    connectorId: z.string(),
    entityTypes: z.array(z.string()).default([]),
    avgLatencyMs: z.number().default(200),
    cacheHitRate: z.number().min(0).max(1).default(0.3),
    costPerRequest: z.number().default(1),
  })).min(1).describe('Available connectors with performance metadata'),
  contextBudget: z.number().int().positive().default(4000).describe('Max token budget for this query'),
  preferLowCost: z.boolean().default(false).describe('Prefer cost savings over throughput'),
  maxLatencyMs: z.number().int().positive().default(2000).describe('SLA latency budget in ms'),
});

export type MultiConnectorQueryOptimizeInput = z.infer<typeof InputSchema>;

/**
 * MCP tool that advises on multi-connector query execution strategy for Claude agents.
 * @param sql - Postgres client
 * @returns MCP tool definition
 */
export function createMultiConnectorQueryOptimizeTool(sql: Sql) {
  const optimizer = new MultiConnectorQueryOptimizer(sql, 'mcp-server');

  return {
    name: 'multi-connector-query-optimize',
    description:
      'Analyzes a business query and recommends the optimal execution strategy when querying across multiple data connectors. Returns strategy recommendation, cost estimates, and reasoning.',
    inputSchema: InputSchema,
    handler: async (input: MultiConnectorQueryOptimizeInput) => {
      const parsed = InputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten() }),
          }],
        };
      }

      try {
        const connectors: ConnectorMeta[] = parsed.data.connectors;
        const plan = optimizer.selectOptimalStrategy(
          parsed.data.query,
          connectors,
          parsed.data.contextBudget,
          {
            maxLatencyMs: parsed.data.maxLatencyMs,
            maxTokens: parsed.data.contextBudget,
            preferLowCost: parsed.data.preferLowCost,
          }
        );

        const summary = [
          `**Recommended Strategy**: ${plan.strategy}`,
          `**Connectors**: ${plan.connectors.join(', ')}`,
          `**Estimated p95 Latency**: ${plan.estimatedLatencyP95Ms}ms`,
          `**Estimated Tokens**: ${plan.estimatedTokens}`,
          `**Reasoning**: ${plan.reasoning}`,
          '',
          '**All Strategy Rankings**:',
          ...plan.strategyRankings.map(
            (r, i) =>
              `${i + 1}. ${r.strategy} (score: ${r.score.toFixed(3)}, ${r.estimatedLatencyP95Ms}ms p95)`
          ),
        ].join('\n');

        logger.info('MCP multi-connector-query-optimize called', {
          strategy: plan.strategy,
          connectorCount: plan.connectors.length,
        });

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (e) {
        logger.error('MCP multi-connector-query-optimize failed', { error: e });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Failed to generate query plan', details: String(e) }),
          }],
        };
      }
    },
  };
}
