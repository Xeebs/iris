import type { SemanticEntity } from '@iris/connector-sdk';
import { logger } from '@iris/core/logger';
import type { VectorStore } from './vector-store.js';
import { retrieveContext } from './retrieval.js';

const log = logger.child({ service: 'advanced-query-engine' });

export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith';
export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type FilterCondition = {
  field: string;
  op: FilterOp;
  value: string | number;
};

export type ParsedAdvancedQuery = {
  entityType: string | undefined;
  filters: FilterCondition[];
  rawQuery: string;
};

export type AggregationSpec = {
  op: AggregateOp;
  field?: string;
  groupBy?: string;
};

export type AggregationGroup = {
  key: string | null;
  value: number;
  count: number;
};

export type AggregationResult = {
  groups: AggregationGroup[];
  total: number;
  op: AggregateOp;
  field?: string;
  groupBy?: string;
  confidence: number;
};

export type ChainedQueryResult = {
  firstQueryEntities: SemanticEntity[];
  chainedEntities: SemanticEntity[];
  combined: SemanticEntity[];
};

const ENTITY_TYPE_ALIASES: Record<string, string> = {
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
  issues: 'issue',
  projects: 'project',
  pages: 'page',
  channels: 'channel',
  users: 'user',
  files: 'file',
  records: 'record',
  accounts: 'company',
  leads: 'contact',
  opportunities: 'deal',
  tickets: 'issue',
};

const NUMERIC_SUFFIXES: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

const OP_TOKENS: [string, FilterOp][] = [
  ['>=', '>='],
  ['<=', '<='],
  ['!=', '!='],
  ['>', '>'],
  ['<', '<'],
  ['=', '='],
  ['contains', 'contains'],
  ['startswith', 'startsWith'],
];

/**
 * Parse a natural language filter expression into a structured query.
 * Supports syntax: "[entityType] [where <field> <op> <value> [and ...]]"
 *
 * @param queryString - e.g. "contacts where industry='SaaS' and ARR>100k"
 * @returns Parsed query with optional entity type and filter conditions
 */
export function parseAdvancedQuery(queryString: string): ParsedAdvancedQuery {
  const raw = queryString.trim();
  const lower = raw.toLowerCase();

  let entityType: string | undefined;
  let filterPart = raw;

  const whereIdx = lower.indexOf(' where ');
  if (whereIdx !== -1) {
    const prefix = raw.slice(0, whereIdx).trim().toLowerCase();
    const normalized = ENTITY_TYPE_ALIASES[prefix] ?? (prefix.length > 0 ? prefix : undefined);
    entityType = normalized;
    filterPart = raw.slice(whereIdx + 7).trim();
  } else {
    const firstToken = lower.split(/\s+/)[0] ?? '';
    if (ENTITY_TYPE_ALIASES[firstToken] !== undefined) {
      entityType = ENTITY_TYPE_ALIASES[firstToken];
      filterPart = raw.slice(firstToken.length).trim();
    }
  }

  const filters = parseFilterConditions(filterPart);

  log.debug('Parsed advanced query', { entityType, filters: filters.length, raw: raw.slice(0, 80) });

  return { entityType, filters, rawQuery: raw };
}

function parseFilterConditions(filterStr: string): FilterCondition[] {
  if (!filterStr) return [];

  const clauses = filterStr.split(/\s+and\s+/i);
  const conditions: FilterCondition[] = [];

  for (const clause of clauses) {
    const condition = parseOneCondition(clause.trim());
    if (condition) conditions.push(condition);
  }

  return conditions;
}

function parseOneCondition(clause: string): FilterCondition | null {
  for (const [token, op] of OP_TOKENS) {
    const idx = clause.toLowerCase().indexOf(token);
    if (idx === -1) continue;

    const field = clause.slice(0, idx).trim();
    const rawValue = clause.slice(idx + token.length).trim().replace(/^['"]|['"]$/g, '');

    if (!field) continue;

    const numValue = parseNumericValue(rawValue);
    const value = numValue !== null ? numValue : rawValue;

    return { field, op, value };
  }
  return null;
}

function parseNumericValue(raw: string): number | null {
  const lower = raw.toLowerCase();
  for (const [suffix, multiplier] of Object.entries(NUMERIC_SUFFIXES)) {
    if (lower.endsWith(suffix)) {
      const base = parseFloat(lower.slice(0, -suffix.length));
      if (!isNaN(base)) return base * multiplier;
    }
  }
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

/**
 * Apply filter conditions to a list of entities.
 * Matches against entity.attributes and entity.label.
 *
 * @param entities - Entities to filter
 * @param filters  - Conditions to apply (AND logic)
 * @returns Subset of entities satisfying all conditions
 */
export function applyFilters(entities: SemanticEntity[], filters: FilterCondition[]): SemanticEntity[] {
  if (filters.length === 0) return entities;

  return entities.filter((entity) =>
    filters.every((f) => evaluateCondition(entity, f)),
  );
}

function getFieldValue(entity: SemanticEntity, field: string): string | number | null {
  const lower = field.toLowerCase();
  if (lower === 'label' || lower === 'name') return entity.label;
  if (lower === 'type') return entity.type;
  if (lower === 'id') return entity.id;

  const attrs = entity.attributes as Record<string, unknown>;
  const val = attrs[field] ?? attrs[lower];
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  return String(val);
}

function evaluateCondition(entity: SemanticEntity, condition: FilterCondition): boolean {
  const val = getFieldValue(entity, condition.field);
  if (val === null) return false;

  const { op, value } = condition;

  switch (op) {
    case '=':
      return String(val).toLowerCase() === String(value).toLowerCase();
    case '!=':
      return String(val).toLowerCase() !== String(value).toLowerCase();
    case '>':
      return typeof val === 'number' && typeof value === 'number' ? val > value
        : String(val) > String(value);
    case '<':
      return typeof val === 'number' && typeof value === 'number' ? val < value
        : String(val) < String(value);
    case '>=':
      return typeof val === 'number' && typeof value === 'number' ? val >= value
        : String(val) >= String(value);
    case '<=':
      return typeof val === 'number' && typeof value === 'number' ? val <= value
        : String(val) <= String(value);
    case 'contains':
      return String(val).toLowerCase().includes(String(value).toLowerCase());
    case 'startsWith':
      return String(val).toLowerCase().startsWith(String(value).toLowerCase());
    default:
      return false;
  }
}

/**
 * Execute an aggregation over a set of entities.
 *
 * @param entities - Input entities to aggregate
 * @param spec     - Aggregation specification (op, field, groupBy)
 * @returns Aggregation result with groups, total, and confidence score
 */
export function executeAggregation(entities: SemanticEntity[], spec: AggregationSpec): AggregationResult {
  const { op, field, groupBy } = spec;

  if (op === 'count' && !field) {
    return computeCount(entities, groupBy);
  }

  if (!field) {
    return {
      groups: [],
      total: 0,
      op,
      confidence: 0,
      ...(field !== undefined ? { field } : {}),
      ...(groupBy !== undefined ? { groupBy } : {}),
    };
  }

  const buckets = groupBy ? groupEntities(entities, groupBy) : new Map([['_all', entities]]);
  const groups: AggregationGroup[] = [];
  let totalValue = 0;
  let totalCount = 0;

  for (const [key, bucket] of buckets) {
    const nums = extractNumericValues(bucket, field);
    if (nums.length === 0 && op !== 'count') continue;

    const value = computeAggregate(nums, op);
    groups.push({ key: key === '_all' ? null : key, value, count: nums.length });
    totalValue += op === 'sum' ? value : 0;
    totalCount += nums.length;
  }

  if (op === 'avg' && groups.length === 1 && groups[0]) {
    totalValue = groups[0].value;
  } else if (op !== 'sum') {
    totalValue = computeAggregate(groups.map((g) => g.value), op);
  }

  const coveredEntities = groups.reduce((s, g) => s + g.count, 0);
  const confidence = entities.length > 0 ? coveredEntities / entities.length : 0;

  log.debug('Aggregation complete', { op, field, groupBy, groups: groups.length, totalCount });

  return {
    groups,
    total: totalValue,
    op,
    field,
    confidence,
    ...(groupBy !== undefined ? { groupBy } : {}),
  };
}

function computeCount(entities: SemanticEntity[], groupBy?: string): AggregationResult {
  if (!groupBy) {
    return {
      groups: [{ key: null, value: entities.length, count: entities.length }],
      total: entities.length,
      op: 'count',
      confidence: 1,
    };
  }

  const buckets = groupEntities(entities, groupBy);
  const groups: AggregationGroup[] = [];
  for (const [key, bucket] of buckets) {
    groups.push({ key, value: bucket.length, count: bucket.length });
  }
  groups.sort((a, b) => b.value - a.value);

  return { groups, total: entities.length, op: 'count', groupBy, confidence: 1 };
}

function groupEntities(entities: SemanticEntity[], groupBy: string): Map<string, SemanticEntity[]> {
  const buckets = new Map<string, SemanticEntity[]>();
  for (const entity of entities) {
    const val = getFieldValue(entity, groupBy);
    const key = val !== null ? String(val) : '__null__';
    const existing = buckets.get(key) ?? [];
    existing.push(entity);
    buckets.set(key, existing);
  }
  return buckets;
}

function extractNumericValues(entities: SemanticEntity[], field: string): number[] {
  const nums: number[] = [];
  for (const entity of entities) {
    const val = getFieldValue(entity, field);
    if (typeof val === 'number') nums.push(val);
    else if (typeof val === 'string') {
      const n = parseNumericValue(val);
      if (n !== null) nums.push(n);
    }
  }
  return nums;
}

function computeAggregate(nums: number[], op: AggregateOp): number {
  if (nums.length === 0) return 0;
  switch (op) {
    case 'count': return nums.length;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
  }
}

/**
 * Execute a multi-step chained query.
 * Runs the first query, then enriches the second query with the first results as context.
 *
 * @param firstQuery   - Primary query to execute
 * @param chainedQuery - Follow-up query executed with awareness of first results
 * @param vectorStore  - Vector store for semantic search
 * @param workspaceId  - Tenant isolation
 * @param openAiApiKey - OpenAI key for embeddings
 * @param topK         - Max entities per query step
 * @returns Combined entity set from both queries
 */
export async function chainQueries(
  firstQuery: string,
  chainedQuery: string,
  vectorStore: VectorStore,
  workspaceId: string,
  openAiApiKey: string,
  topK = 10,
): Promise<ChainedQueryResult> {
  const firstResult = await retrieveContext(firstQuery, vectorStore, {
    workspaceId,
    topK,
    expandRelationships: false,
    maxDepth: 0,
    openAiApiKey,
  });

  const firstEntities = firstResult.entities;
  const contextHints = firstEntities
    .slice(0, 5)
    .map((e) => `${e.type}: ${e.label}`)
    .join(', ');

  const enrichedQuery = contextHints
    ? `${chainedQuery} (related to: ${contextHints})`
    : chainedQuery;

  const chainedResult = await retrieveContext(enrichedQuery, vectorStore, {
    workspaceId,
    topK,
    expandRelationships: false,
    maxDepth: 0,
    openAiApiKey,
  });

  const chainedEntities = chainedResult.entities;

  const seenIds = new Set(firstEntities.map((e) => e.id));
  const uniqueChained = chainedEntities.filter((e) => !seenIds.has(e.id));
  const combined = [...firstEntities, ...uniqueChained];

  log.info('Chained query complete', {
    workspaceId,
    firstCount: firstEntities.length,
    chainedCount: chainedEntities.length,
    combinedCount: combined.length,
  });

  return { firstQueryEntities: firstEntities, chainedEntities, combined };
}

/**
 * Format an aggregation result as a human-readable text summary.
 *
 * @param result    - AggregationResult to format
 * @param queryText - Original query for context
 * @returns Formatted text suitable for MCP response
 */
export function formatAggregationResult(result: AggregationResult, queryText: string): string {
  const { op, field, groupBy, groups, total, confidence } = result;

  const header = groupBy
    ? `${op.toUpperCase()} of ${field ?? 'entities'} grouped by ${groupBy}`
    : `${op.toUpperCase()} of ${field ?? 'entities'}`;

  const lines: string[] = [`Query: ${queryText}`, `Aggregation: ${header}`, ''];

  if (groups.length === 0) {
    lines.push('No numeric data found for the specified field.');
    return lines.join('\n');
  }

  if (groupBy) {
    lines.push(`${groupBy.toUpperCase()} | ${op.toUpperCase()} | COUNT`);
    lines.push('---');
    for (const g of groups) {
      const key = g.key ?? '(none)';
      const val = op === 'avg' ? g.value.toFixed(2) : g.value.toLocaleString();
      lines.push(`${key} | ${val} | ${g.count}`);
    }
    lines.push('');
  }

  const totalFormatted = op === 'avg' ? total.toFixed(2) : total.toLocaleString();
  lines.push(`Total ${op}: ${totalFormatted}`);

  if (confidence < 1) {
    lines.push(`Confidence: ${(confidence * 100).toFixed(0)}% (${Math.round(confidence * groups.reduce((s, g) => s + g.count, 0))} of ${groups.reduce((s, g) => s + g.count, 0)} entities had numeric data)`);
  }

  return lines.join('\n');
}
