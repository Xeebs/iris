import { z } from 'zod';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { MetricsAnomalyDetector } from '@iris/semantic-core/metrics-anomaly-detector';
import type { MetricAnomaly, ForecastPoint } from '@iris/semantic-core/metrics-anomaly-detector';
import { logger } from '@iris/core/logger';

const log = logger.child({ tool: 'detect-anomalies' });

export const detectAnomaliesZodSchema = z.object({
  metricId: z.string().min(1).describe('The metric ID to analyze for anomalies'),
  lookbackDays: z.number().int().min(1).max(365).optional().default(30)
    .describe('Number of historical days to analyze (default: 30)'),
  sensitivity: z.enum(['low', 'medium', 'high']).optional().default('medium')
    .describe('Detection sensitivity — high catches more anomalies but may produce false positives'),
  includeForecast: z.boolean().optional().default(false)
    .describe('Whether to include a 7-day forecast alongside anomaly detection'),
});

type DetectAnomaliesInput = z.infer<typeof detectAnomaliesZodSchema>;

type ToolResult = {
  content: { type: 'text'; text: string }[];
};

function formatAnomaly(a: MetricAnomaly): string {
  const ackNote = a.acknowledgedAt ? ' (acknowledged)' : '';
  return `  - [${a.severity.toUpperCase()}] ${a.anomalyDate.toISOString().split('T')[0]}: observed=${a.observedValue}, expected=${a.expectedValue.toFixed(2)}, z=${a.zScore.toFixed(2)}σ${ackNote}`;
}

function formatForecast(p: ForecastPoint): string {
  const trendArrow = p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→';
  return `  - ${p.date.toISOString().split('T')[0]}: ${p.forecastedValue} ${trendArrow}`;
}

/**
 * MCP tool: detect-anomalies
 * Analyzes a metric for statistical anomalies and optionally returns a forecast.
 * Enriches query-time context with "metric X had an anomaly N days ago" signals.
 *
 * @param input - Validated tool input
 * @param sql - Postgres tagged-template client
 * @returns MCP content array with anomaly/forecast summary
 */
export async function detectAnomalyTool(
  input: DetectAnomaliesInput,
  sql: ConstructorParameters<typeof MetricsAnomalyDetector>[0]
): Promise<Result<ToolResult, Error>> {
  const parsed = detectAnomaliesZodSchema.safeParse(input);
  if (!parsed.success) {
    return ok({
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten() }),
      }],
    });
  }

  const { metricId, lookbackDays, sensitivity, includeForecast } = parsed.data;
  const detector = new MetricsAnomalyDetector(sql);

  log.info('detect-anomalies tool invoked', { metricId, lookbackDays, sensitivity, includeForecast });

  const anomalyResult = await detector.detectAnomalies(metricId, lookbackDays, sensitivity);
  if (anomalyResult.isErr()) {
    return ok({
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'Anomaly detection failed', metricId }),
      }],
    });
  }

  const anomalies = anomalyResult.value;
  const lines: string[] = [];

  lines.push(`Anomaly Analysis: ${metricId} (last ${lookbackDays} days, sensitivity: ${sensitivity})`);
  lines.push('');

  if (anomalies.length === 0) {
    lines.push('No anomalies detected.');
  } else {
    const unacked = anomalies.filter(a => !a.acknowledgedAt);
    lines.push(`Found ${anomalies.length} anomaly(s) (${unacked.length} unacknowledged):`);
    for (const a of anomalies) {
      lines.push(formatAnomaly(a));
    }

    const mostRecent = anomalies.reduce((m, a) => a.anomalyDate > m.anomalyDate ? a : m);
    const daysAgo = Math.round((Date.now() - mostRecent.anomalyDate.getTime()) / 86_400_000);
    lines.push('');
    lines.push(`Most recent: ${daysAgo === 0 ? 'today' : `${daysAgo} day(s) ago`}, severity: ${mostRecent.severity}`);
  }

  if (includeForecast) {
    const forecastResult = await detector.forecastMetricValue(metricId, 7);
    if (forecastResult.isOk() && forecastResult.value.length > 0) {
      lines.push('');
      lines.push('7-Day Forecast:');
      for (const p of forecastResult.value) {
        lines.push(formatForecast(p));
      }
    }
  }

  return ok({
    content: [{ type: 'text', text: lines.join('\n') }],
  });
}

export const detectAnomaliesToolDefinition = {
  name: 'detect-anomalies' as const,
  description: 'Detect statistical anomalies in a metric and optionally forecast future values. Useful for surfacing "metric X had an anomaly N days ago" context in AI responses.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      metricId: { type: 'string', description: 'The metric ID to analyze' },
      lookbackDays: { type: 'number', description: 'Days of history to analyze (1-365, default 30)' },
      sensitivity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Detection sensitivity (default medium)' },
      includeForecast: { type: 'boolean', description: 'Include 7-day forecast (default false)' },
    },
    required: ['metricId'],
  },
};
