import { z } from 'zod';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ tool: 'aggregate-entities' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Input schema ─────────────────────────────────────────────────────────────

export const aggregateEntitiesZodSchema = z.object({
  entityType: z.string().min(1),
  groupByAttribute: z.string().min(1),
  aggregations: z
    .array(z.enum(['count', 'sum', 'avg', 'max', 'min']))
    .min(1)
    .default(['count']),
  sumField: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  topK: z.number().int().min(1).max(100).default(10),
  workspaceId: z.string().min(1),
  contextBudget: z.number().int().min(100).default(2000),
});

type AggregateInput = z.infer<typeof aggregateEntitiesZodSchema>;

type AggregateGroup = {
  groupValue: string;
  count: number;
  sum: number | undefined;
  avg: number | undefined;
  max: number | undefined;
  min: number | undefined;
};

type ToolResult = { content: { type: 'text'; text: string }[] };

// ─── Token estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Aggregation logic ────────────────────────────────────────────────────────

function groupEntities(
  entities: { attributes: Record<string, unknown> }[],
  groupBy: string,
  aggregations: AggregateInput['aggregations'],
  sumField?: string
): AggregateGroup[] {
  const groups = new Map<string, { values: number[]; count: number }>();

  for (const entity of entities) {
    const groupVal = String(entity.attributes[groupBy] ?? '(none)');
    if (!groups.has(groupVal)) {
      groups.set(groupVal, { values: [], count: 0 });
    }
    const g = groups.get(groupVal)!;
    g.count += 1;

    const numericField = sumField ?? groupBy;
    const rawVal = entity.attributes[numericField];
    const n = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal ?? ''));
    if (!isNaN(n)) g.values.push(n);
  }

  const results: AggregateGroup[] = [];
  for (const [groupValue, { values, count }] of groups) {
    const needsNum = aggregations.some(a => a !== 'count');
    results.push({
      groupValue,
      count,
      sum: needsNum && values.length > 0 ? values.reduce((s, v) => s + v, 0) : undefined,
      avg: needsNum && values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : undefined,
      max: needsNum && values.length > 0 ? Math.max(...values) : undefined,
      min: needsNum && values.length > 0 ? Math.min(...values) : undefined,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

function formatGroups(
  groups: AggregateGroup[],
  aggregations: AggregateInput['aggregations'],
  contextBudget: number,
  entityType: string,
  groupBy: string
): { text: string; truncated: boolean } {
  const header = `${entityType} grouped by ${groupBy} (top ${groups.length}):\n`;
  const lines: string[] = [];
  let truncated = false;

  for (const g of groups) {
    const parts: string[] = [`${g.groupValue}: count=${g.count}`];
    if (aggregations.includes('sum') && g.sum !== undefined) parts.push(`sum=${g.sum.toFixed(2)}`);
    if (aggregations.includes('avg') && g.avg !== undefined) parts.push(`avg=${g.avg.toFixed(2)}`);
    if (aggregations.includes('max') && g.max !== undefined) parts.push(`max=${g.max}`);
    if (aggregations.includes('min') && g.min !== undefined) parts.push(`min=${g.min}`);
    lines.push(`  ${parts.join(', ')}`);
  }

  const full = header + lines.join('\n');
  if (estimateTokens(full) <= contextBudget) {
    return { text: full, truncated: false };
  }

  // truncate to fit budget
  const budgetChars = contextBudget * 4 - header.length;
  let accumulated = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (accumulated + line.length > budgetChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    accumulated += line.length + 1;
  }
  return { text: header + kept.join('\n') + (truncated ? '\n  [truncated]' : ''), truncated };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * MCP tool: aggregate-entities
 * Groups entities by an attribute and returns aggregated metrics within context budget.
 *
 * @param input - Tool input (validated)
 * @param sql - Postgres tagged-template client
 */
export async function aggregateEntitiesTool(
  input: AggregateInput,
  sql: SqlFn
): Promise<Result<ToolResult, Error>> {
  const parsed = aggregateEntitiesZodSchema.safeParse(input);
  if (!parsed.success) {
    return ok({ content: [{ type: 'text', text: JSON.stringify({ error: parsed.error.flatten() }) }] });
  }

  const { entityType, groupByAttribute, aggregations, sumField, filters, topK, workspaceId, contextBudget } = parsed.data;

  log.info('aggregate-entities invoked', { entityType, groupByAttribute, topK });

  try {
    const rows = await sql`
      SELECT attributes
      FROM indexed_entities
      WHERE workspace_id = ${workspaceId}
        AND entity_type = ${entityType}
      LIMIT 10000
    ` as { attributes: Record<string, unknown> }[];

    let entities = rows;

    if (filters && Object.keys(filters).length > 0) {
      entities = rows.filter(e =>
        Object.entries(filters).every(([k, v]) => String(e.attributes[k]) === String(v))
      );
    }

    const groups = groupEntities(entities, groupByAttribute, aggregations, sumField).slice(0, topK);
    const { text, truncated } = formatGroups(groups, aggregations, contextBudget, entityType, groupByAttribute);

    const result = truncated ? `${text}\n\n[truncated: true]` : text;

    log.info('aggregate-entities complete', { entityType, groups: groups.length, truncated });
    return ok({ content: [{ type: 'text', text: result }] });
  } catch (e) {
    log.error('aggregate-entities failed', { entityType, error: String(e) });
    return ok({ content: [{ type: 'text', text: JSON.stringify({ error: 'Aggregation failed', entityType }) }] });
  }
}

export const aggregateEntitiesToolDefinition = {
  name: 'aggregate-entities' as const,
  description:
    'Group entities by an attribute and compute aggregations (count, sum, avg, max, min). Returns top K groups sorted by count, within context budget.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      entityType: { type: 'string', description: 'Type of entity to aggregate (e.g. contact, deal)' },
      groupByAttribute: { type: 'string', description: 'Attribute name to group by' },
      aggregations: {
        type: 'array',
        items: { type: 'string', enum: ['count', 'sum', 'avg', 'max', 'min'] },
        description: 'Aggregation functions to compute (default: [count])',
      },
      sumField: { type: 'string', description: 'Numeric field for sum/avg/max/min (defaults to groupByAttribute)' },
      filters: { type: 'object', description: 'Key-value filters to apply before aggregating' },
      topK: { type: 'number', description: 'Max number of groups to return (default 10)' },
      workspaceId: { type: 'string', description: 'Workspace to query' },
      contextBudget: { type: 'number', description: 'Token budget for response (default 2000)' },
    },
    required: ['entityType', 'groupByAttribute', 'workspaceId'],
  },
};
