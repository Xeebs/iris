import { z } from 'zod';

export const entityTrendAnalysisSchema = z.object({
  metricName: z.string().min(1),
  workspaceId: z.string().default('default'),
  windowDays: z.number().int().min(1).max(365).default(30),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

export type EntityTrendAnalysisInput = z.infer<typeof entityTrendAnalysisSchema>;

export type TrendDataPoint = {
  period: string;
  value: number;
  changeFromPrevious: number | null;
  changePercent: number | null;
};

export type TrendAnalysisResult = {
  metricName: string;
  workspaceId: string;
  windowDays: number;
  trend: 'up' | 'down' | 'stable';
  averageValue: number;
  dataPoints: TrendDataPoint[];
};

/**
 * Compute trend direction from a series of values.
 */
export function computeTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 2) return 'stable';
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  if (changePct > 5) return 'up';
  if (changePct < -5) return 'down';
  return 'stable';
}

/**
 * MCP tool: entity-trend-analysis
 *
 * Analyzes metric trends over a time window, returning period-over-period changes
 * and an overall trend direction (up/down/stable).
 */
export const entityTrendAnalysisTool = {
  name: 'entity-trend-analysis',
  description: 'Analyze metric trends over a time window with period-over-period comparison.',
  inputSchema: entityTrendAnalysisSchema,

  async execute(
    input: EntityTrendAnalysisInput,
    deps: { sql: import('postgres').Sql },
  ): Promise<{ content: [{ type: 'text'; text: string }] }> {
    const { metricName, workspaceId, windowDays, granularity } = input;
    const { sql } = deps;

    const truncUnit = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';

    type MetricRow = { period: Date; avg_value: number };
    const rows = await sql<MetricRow[]>`
      SELECT DATE_TRUNC(${truncUnit}, recorded_at) AS period,
             AVG(value) AS avg_value
      FROM metric_values
      WHERE workspace_id = ${workspaceId}
        AND metric_name = ${metricName}
        AND recorded_at > NOW() - ${windowDays} * INTERVAL '1 day'
      GROUP BY DATE_TRUNC(${truncUnit}, recorded_at)
      ORDER BY period ASC
    `;

    const dataPoints: TrendDataPoint[] = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1]! : null;
      const changeFromPrevious = prev ? r.avg_value - prev.avg_value : null;
      const changePercent = prev && prev.avg_value !== 0 ? (changeFromPrevious! / prev.avg_value) * 100 : null;
      return {
        period: r.period.toISOString().slice(0, 10),
        value: Math.round(r.avg_value * 100) / 100,
        changeFromPrevious: changeFromPrevious !== null ? Math.round(changeFromPrevious * 100) / 100 : null,
        changePercent: changePercent !== null ? Math.round(changePercent * 10) / 10 : null,
      };
    });

    const values = dataPoints.map((d) => d.value);
    const averageValue = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    const result: TrendAnalysisResult = {
      metricName,
      workspaceId,
      windowDays,
      trend: computeTrend(values),
      averageValue: Math.round(averageValue * 100) / 100,
      dataPoints,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
};
