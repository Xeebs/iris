import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@iris/core/logger';
import { ReliabilityPredictor } from '@iris/semantic-core/reliability-predictor';

import { registerTool } from '../register-tool.js';
import type postgres from 'postgres';

const log = logger.child({ tool: 'connector-health-forecast' });

const inputSchema = {
  connectorId: z.string().min(1).describe('Connector ID to forecast'),
  workspaceId: z.string().min(1).optional().describe('Workspace ID (defaults to the authenticated key\'s workspace)'),
  includeScore: z.boolean().optional().default(true).describe('Include current reliability score'),
  includeForecast: z.boolean().optional().default(true).describe('Include failure likelihood forecast'),
  includeMitigations: z.boolean().optional().default(false).describe('Include mitigation suggestions'),
};

type ToolInput = z.infer<z.ZodObject<typeof inputSchema>> & { workspaceId: string };

/**
 * Registers the connector-health-forecast MCP tool.
 * Allows Claude agents to predict reliability issues for a connector.
 * @param server - MCP server instance
 * @param sql - Postgres client
 * @param authenticatedWorkspaceId - Workspace from validated API key, or null in dev mode
 */
export function registerConnectorHealthForecastTool(
  server: McpServer,
  sql: ReturnType<typeof postgres>,
  authenticatedWorkspaceId: string | null = null,
): void {
  registerTool(
    server,
    'connector-health-forecast',
    {
      description: 'Predict reliability issues and failure likelihood for a connector. Returns current health score, degradation patterns, and failure probabilities over 1h/24h/7d windows.',
      inputSchema,
      authenticatedWorkspaceId,
    },
    async (rawInput) => {
      const { connectorId, workspaceId, includeScore, includeForecast, includeMitigations } = rawInput as ToolInput;
      const predictor = new ReliabilityPredictor(sql);
      try {
        const results: Record<string, unknown> = { connectorId, workspaceId };

        if (includeScore) {
          const [scoreResult, patternResult] = await Promise.allSettled([
            predictor.computeReliabilityScore(connectorId, workspaceId),
            predictor.detectDegradationPattern(connectorId, workspaceId),
          ]);
          if (scoreResult.status === 'fulfilled' && scoreResult.value.isOk()) {
            results['reliabilityScore'] = scoreResult.value.value;
          }
          if (patternResult.status === 'fulfilled' && patternResult.value.isOk()) {
            results['degradationPattern'] = patternResult.value.value;
          }
        }

        if (includeForecast) {
          const forecastResult = await predictor.forecastNextFailure(connectorId, workspaceId);
          if (forecastResult.isOk()) {
            results['forecast'] = forecastResult.value;
          }
        }

        if (includeMitigations) {
          const mitigResult = await predictor.suggestMitigations(connectorId, workspaceId);
          if (mitigResult.isOk()) {
            results['mitigations'] = mitigResult.value;
          }
        }

        log.info('Connector health forecast served', { connectorId, workspaceId });
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('connector-health-forecast failed', { error: msg, connectorId, workspaceId });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
      }
    },
  );
}
