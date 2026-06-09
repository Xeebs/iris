import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@iris/core/logger';
import { ReliabilityPredictor } from '@iris/semantic-core/reliability-predictor';
import type postgres from 'postgres';

const log = logger.child({ tool: 'connector-health-forecast' });

const inputSchema = {
  connectorId: z.string().min(1).describe('Connector ID to forecast'),
  workspaceId: z.string().min(1).describe('Workspace ID'),
  includeScore: z.boolean().optional().default(true).describe('Include current reliability score'),
  includeForecast: z.boolean().optional().default(true).describe('Include failure likelihood forecast'),
  includeMitigations: z.boolean().optional().default(false).describe('Include mitigation suggestions'),
};

/**
 * Registers the connector-health-forecast MCP tool.
 * Allows Claude agents to predict reliability issues for a connector.
 * @param server - MCP server instance
 * @param sql - Postgres client
 */
export function registerConnectorHealthForecastTool(
  server: McpServer,
  sql: ReturnType<typeof postgres>,
): void {
  server.tool(
    'connector-health-forecast',
    'Predict reliability issues and failure likelihood for a connector. Returns current health score, degradation patterns, and failure probabilities over 1h/24h/7d windows.',
    inputSchema,
    async ({ connectorId, workspaceId, includeScore, includeForecast, includeMitigations }) => {
      const predictor = new ReliabilityPredictor(sql);
      const parts: string[] = [];

      try {
        if (includeScore) {
          const [scoreResult, patternResult] = await Promise.all([
            predictor.computeReliabilityScore(connectorId, workspaceId),
            predictor.detectDegradationPattern(connectorId, workspaceId),
          ]);

          if (scoreResult.isOk()) {
            const s = scoreResult.value;
            parts.push(
              `## Reliability Score: ${s.score}/100 (${s.trend})\n` +
              `- Success rate: ${(s.successRate * 100).toFixed(1)}%\n` +
              `- Error rate: ${(s.errorRate * 100).toFixed(1)}%\n` +
              `- Latency p95: ${s.latencyP95Ms}ms\n` +
              `- Schema stability: ${(s.schemaStability * 100).toFixed(0)}%`,
            );
          }

          if (patternResult.isOk() && patternResult.value.anomalyDetected) {
            const p = patternResult.value;
            parts.push(
              `## Anomaly Detected\n` +
              `- Dominant signal: ${p.dominantSignal ?? 'unknown'}\n` +
              `- Error rate Z-score: ${p.zScoreErrorRate}\n` +
              `- Latency Z-score: ${p.zScoreLatency}\n` +
              `- Auth failures: ${p.authFailures}`,
            );
          }
        }

        if (includeForecast) {
          const forecastResult = await predictor.forecastNextFailure(connectorId, workspaceId);
          if (forecastResult.isOk()) {
            const f = forecastResult.value;
            parts.push(
              `## Failure Likelihood\n` +
              `- Next 1 hour: ${f.likelihood1h}%\n` +
              `- Next 24 hours: ${f.likelihood24h}%\n` +
              `- Next 7 days: ${f.likelihood7d}%\n` +
              `- Smoothed error rate: ${f.smoothedErrorRate}%`,
            );
          }
        }

        if (includeMitigations) {
          const mitigResult = await predictor.suggestMitigations(connectorId, workspaceId);
          if (mitigResult.isOk() && mitigResult.value.length > 0) {
            const actions = mitigResult.value
              .map((m) => `- [${m.priority.toUpperCase()}] ${m.action}: ${m.rationale}`)
              .join('\n');
            parts.push(`## Recommended Actions\n${actions}`);
          }
        }

        if (parts.length === 0) {
          parts.push(`Connector **${connectorId}** has no forecast data available yet.`);
        }

        log.info('Connector health forecast served', { connectorId, workspaceId });

        return {
          content: [{ type: 'text' as const, text: parts.join('\n\n') }],
        };
      } catch (e) {
        log.error('connector-health-forecast failed', { connectorId, error: e });
        return {
          content: [{ type: 'text' as const, text: `Error fetching health forecast for connector ${connectorId}.` }],
        };
      }
    },
  );
}
