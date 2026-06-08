'use client';

import type { FilterRule } from './filter-rule-editor.js';

export type AggregationFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregationConfig {
  fn: AggregationFn;
  field: string;
  groupBy?: string;
}

interface QueryPreviewProps {
  entityType: string;
  rules: FilterRule[];
  aggregation?: AggregationConfig;
  limit: number;
}

export function buildFilterString(rules: FilterRule[]): string {
  if (rules.length === 0) return '';
  return rules
    .filter((r) => r.field && r.value)
    .map((r) => {
      const val = r.operator === 'in'
        ? `[${r.value.split(',').map((v) => `"${v.trim()}"`).join(', ')}]`
        : `"${r.value}"`;
      return `${r.field} ${r.operator} ${val}`;
    })
    .join(' AND ');
}

export function buildQueryString(
  entityType: string,
  rules: FilterRule[],
  aggregation?: AggregationConfig,
  limit = 20,
): string {
  if (!entityType) return '';

  const filterStr = buildFilterString(rules);
  const parts: string[] = [`FROM ${entityType}`];

  if (filterStr) parts.push(`WHERE ${filterStr}`);

  if (aggregation?.fn) {
    const aggExpr = aggregation.fn === 'count'
      ? 'COUNT(*)'
      : `${aggregation.fn.toUpperCase()}(${aggregation.field || '*'})`;
    parts.unshift(`SELECT ${aggExpr}`);
    if (aggregation.groupBy) parts.push(`GROUP BY ${aggregation.groupBy}`);
  } else {
    parts.unshift('SELECT *');
    parts.push(`LIMIT ${limit}`);
  }

  return parts.join('\n');
}

export function QueryPreview({ entityType, rules, aggregation, limit }: QueryPreviewProps) {
  const queryStr = buildQueryString(entityType, rules, aggregation, limit);

  if (!queryStr) {
    return (
      <div
        style={{
          padding: '0.75rem',
          background: '#f1f5f9',
          borderRadius: '0.375rem',
          fontSize: '0.8125rem',
          color: '#94a3b8',
          fontFamily: 'monospace',
        }}
      >
        Select an entity type to preview the query…
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '0.875rem',
        background: '#0f172a',
        borderRadius: '0.5rem',
        fontSize: '0.8125rem',
        color: '#94a3b8',
        fontFamily: 'monospace',
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      aria-label="Query string preview"
    >
      {queryStr.split('\n').map((line, i) => {
        const keyword = line.match(/^(SELECT|FROM|WHERE|GROUP BY|LIMIT)/)?.[1];
        return (
          <div key={i}>
            {keyword ? (
              <>
                <span style={{ color: '#7dd3fc' }}>{keyword}</span>
                {line.slice(keyword.length)}
              </>
            ) : line}
          </div>
        );
      })}
    </div>
  );
}
