import { z } from 'zod';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ tool: 'compare-entities' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Input schema ─────────────────────────────────────────────────────────────

const compareSchema = z.object({
  entityIds: z.array(z.string()).min(2).max(10),
  attributes: z.union([z.literal('all'), z.array(z.string())]).default('all'),
  diffHighlight: z.boolean().default(true),
  workspaceId: z.string().min(1),
  contextBudget: z.number().int().min(100).default(2000),
});

type CompareInput = z.infer<typeof compareSchema>;

type EntityRow = {
  entity_id: string;
  entity_type: string;
  label: string;
  attributes: Record<string, unknown>;
};

type ToolResult = { content: { type: 'text'; text: string }[] };

// ─── Token estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Comparison logic ─────────────────────────────────────────────────────────

function collectAttributes(entities: EntityRow[], requested: 'all' | string[]): string[] {
  if (requested === 'all') {
    const all = new Set<string>();
    for (const e of entities) {
      for (const k of Object.keys(e.attributes)) all.add(k);
    }
    return Array.from(all).sort();
  }
  return requested;
}

function isDifferent(entities: EntityRow[], attr: string): boolean {
  const values = entities.map(e => String(e.attributes[attr] ?? ''));
  return new Set(values).size > 1;
}

function formatComparison(
  entities: EntityRow[],
  attrs: string[],
  diffHighlight: boolean,
  contextBudget: number
): { text: string; truncated: boolean } {
  if (entities.length === 0) return { text: 'No entities found.', truncated: false };

  const targetAttrs = diffHighlight ? attrs.filter(a => isDifferent(entities, a)) : attrs;

  // header row
  const colWidth = Math.max(20, Math.floor(60 / entities.length));
  const header = `Attribute`.padEnd(24) + entities.map(e => e.label.slice(0, colWidth).padEnd(colWidth + 2)).join('');
  const separator = '-'.repeat(header.length);

  const rows: string[] = [header, separator];

  for (const attr of targetAttrs) {
    const values = entities.map(e => String(e.attributes[attr] ?? '—').slice(0, colWidth).padEnd(colWidth + 2));
    rows.push(attr.slice(0, 23).padEnd(24) + values.join(''));
  }

  if (diffHighlight && targetAttrs.length < attrs.length) {
    rows.push(`\n(${attrs.length - targetAttrs.length} matching attributes hidden)`);
  }

  const full = rows.join('\n');
  if (estimateTokens(full) <= contextBudget) {
    return { text: full, truncated: false };
  }

  // truncate: drop rows until it fits
  let truncated = false;
  const kept: string[] = [rows[0]!, rows[1]!];
  const budgetChars = contextBudget * 4;
  let chars = kept.join('\n').length;
  for (let i = 2; i < rows.length; i++) {
    if (chars + rows[i]!.length + 1 > budgetChars) {
      truncated = true;
      break;
    }
    kept.push(rows[i]!);
    chars += rows[i]!.length + 1;
  }

  return { text: kept.join('\n') + (truncated ? '\n[truncated: true]' : ''), truncated };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * MCP tool: compare-entities
 * Side-by-side attribute comparison of 2-10 entities, with optional diff-only highlighting.
 *
 * @param input - Tool input (validated)
 * @param sql - Postgres tagged-template client
 */
export async function compareEntitiesTool(
  input: CompareInput,
  sql: SqlFn
): Promise<Result<ToolResult, Error>> {
  const parsed = compareSchema.safeParse(input);
  if (!parsed.success) {
    return ok({ content: [{ type: 'text', text: JSON.stringify({ error: parsed.error.flatten() }) }] });
  }

  const { entityIds, attributes, diffHighlight, workspaceId, contextBudget } = parsed.data;

  log.info('compare-entities invoked', { entityCount: entityIds.length, diffHighlight });

  try {
    const rows = await sql`
      SELECT entity_id, entity_type, label, attributes
      FROM semantic_entities
      WHERE workspace_id = ${workspaceId}
        AND entity_id = ANY(${entityIds}::text[])
    ` as EntityRow[];

    if (rows.length === 0) {
      return ok({ content: [{ type: 'text', text: 'No entities found for the given IDs.' }] });
    }

    // preserve input order
    const ordered = entityIds
      .map(id => rows.find(r => r.entity_id === id))
      .filter((r): r is EntityRow => r !== undefined);

    const attrs = collectAttributes(ordered, attributes);
    const { text, truncated } = formatComparison(ordered, attrs, diffHighlight, contextBudget);
    const result = truncated ? `${text}\n\n[truncated: true]` : text;

    log.info('compare-entities complete', { entityCount: ordered.length, attrCount: attrs.length, truncated });
    return ok({ content: [{ type: 'text', text: result }] });
  } catch (e) {
    log.error('compare-entities failed', { entityIds, error: String(e) });
    return ok({ content: [{ type: 'text', text: JSON.stringify({ error: 'Comparison failed' }) }] });
  }
}

export const compareEntitiesToolDefinition = {
  name: 'compare-entities' as const,
  description:
    'Side-by-side attribute comparison of 2-10 entities. diffHighlight=true (default) shows only attributes that differ between entities, keeping the response compact.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      entityIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 10,
        description: 'Entity IDs to compare (2-10)',
      },
      attributes: {
        description: '"all" to compare all attributes, or a list of specific attribute names',
        oneOf: [
          { type: 'string', enum: ['all'] },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      diffHighlight: {
        type: 'boolean',
        description: 'Only show attributes that differ across entities (default true)',
      },
      workspaceId: { type: 'string', description: 'Workspace to query' },
      contextBudget: { type: 'number', description: 'Token budget (default 2000)' },
    },
    required: ['entityIds', 'workspaceId'],
  },
};
