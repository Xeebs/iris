'use client';

import React, { useState } from 'react';
import type { CuratedTemplate } from './workflow-catalog-grid.js';

type Props = {
  template: CuratedTemplate;
  onSubmit?: (params: ExecuteParams) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
};

export type ExecuteParams = {
  connectorIds: string[];
  dateRange: string;
  entityTypeFilters: string[];
  contextBudget: number;
};

const DATE_RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const ENTITY_TYPE_OPTIONS = ['contact', 'company', 'deal', 'invoice', 'task', 'project', 'person'];

function estimateBudget(topKTotal: number, entityCount: number): number {
  return Math.min(8000, Math.max(2000, topKTotal * 150 + entityCount * 100));
}

export function ExecuteWorkflowForm({ template, onSubmit, onCancel, isSubmitting }: Props) {
  const defaultTopK = template.mcpCalls.reduce((acc, c) => {
    const params = c.params as Record<string, unknown>;
    return acc + (typeof params['topK'] === 'number' ? params['topK'] : 0);
  }, 0);

  const defaultEntityTypes = Array.from(new Set(
    template.mcpCalls.flatMap((c) => {
      const p = c.params as Record<string, unknown>;
      return Array.isArray(p['entityTypes']) ? (p['entityTypes'] as string[]) : [];
    })
  ));

  const [connectorIds, setConnectorIds] = useState<string[]>(template.recommendedConnectors.slice(0, 1));
  const [dateRange, setDateRange] = useState('30d');
  const [entityTypeFilters, setEntityTypeFilters] = useState<string[]>(defaultEntityTypes);
  const [contextBudget, setContextBudget] = useState(estimateBudget(defaultTopK, defaultEntityTypes.length));

  function toggleConnector(id: string) {
    setConnectorIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function toggleEntityType(type: string) {
    const next = entityTypeFilters.includes(type)
      ? entityTypeFilters.filter((t) => t !== type)
      : [...entityTypeFilters, type];
    setEntityTypeFilters(next);
    setContextBudget(estimateBudget(defaultTopK, next.length));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit?.({ connectorIds, dateRange, entityTypeFilters, contextBudget });
  }

  const budgetPct = Math.round((contextBudget / 8000) * 100);

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
          Connectors
        </label>
        <div className="flex flex-wrap gap-2">
          {template.recommendedConnectors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleConnector(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                connectorIds.includes(c)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
          Date Range
        </label>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {DATE_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
          Entity Type Filters
        </label>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPE_OPTIONS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleEntityType(type)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                entityTypeFilters.includes(type)
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Context Budget
          </label>
          <span className="text-xs font-medium text-gray-700">{contextBudget.toLocaleString()} / 8,000</span>
        </div>
        <input
          type="range"
          min={100}
          max={8000}
          step={100}
          value={contextBudget}
          onChange={(e) => setContextBudget(Number(e.target.value))}
          className="w-full"
        />
        <div className="h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${budgetPct > 80 ? 'bg-orange-500' : 'bg-blue-500'}`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-600 mb-1">MCP Call Sequence</p>
        <ol className="space-y-1">
          {template.mcpCalls.map((call, i) => (
            <li key={i} className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="font-bold text-gray-400">{i + 1}.</span>
              <span className="font-medium text-gray-700">{call.tool}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? 'Starting…' : 'Run Workflow'}
        </button>
      </div>
    </form>
  );
}
