'use client';

import { useState } from 'react';
import type { SearchFilters } from '@iris/semantic-core/hybrid-search-engine';

interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

interface FacetedFilterSidebarProps {
  entityTypeOptions: FacetOption[];
  connectorOptions: FacetOption[];
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-gray-100 pb-4">
      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-sm font-medium text-gray-700"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>{label}</span>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <ul className="mt-1 space-y-1">
          {options.map((opt) => (
            <li key={opt.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-gray-600 hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                  checked={selected.includes(opt.value)}
                  onChange={() => onToggle(opt.value)}
                />
                <span className="flex-1">{opt.label}</span>
                {opt.count !== undefined && (
                  <span className="text-xs text-gray-400">{opt.count}</span>
                )}
              </label>
            </li>
          ))}
          {options.length === 0 && (
            <li className="py-1 text-xs text-gray-400">No options</li>
          )}
        </ul>
      )}
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string | undefined;
  to: string | undefined;
  onChange: (from: string | undefined, to: string | undefined) => void;
}) {
  return (
    <div className="border-b border-gray-100 pb-4">
      <p className="py-2 text-sm font-medium text-gray-700">Date Range</p>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-500">From</label>
          <input
            type="date"
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
            value={from ? from.slice(0, 10) : ''}
            onChange={(e) => onChange(e.target.value ? `${e.target.value}T00:00:00Z` : undefined, to)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">To</label>
          <input
            type="date"
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
            value={to ? to.slice(0, 10) : ''}
            onChange={(e) => onChange(from, e.target.value ? `${e.target.value}T23:59:59Z` : undefined)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar panel with entity type, connector, and date range filters for search.
 */
export function FacetedFilterSidebar({
  entityTypeOptions,
  connectorOptions,
  filters,
  onChange,
}: FacetedFilterSidebarProps) {
  function toggleEntityType(value: string) {
    const current = filters.entityTypes ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, entityTypes: next.length > 0 ? next : undefined });
  }

  function toggleConnector(value: string) {
    const current = filters.connectorIds ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, connectorIds: next.length > 0 ? next : undefined });
  }

  function handleDateChange(from: string | undefined, to: string | undefined) {
    const dateRange = from || to ? { from, to } : undefined;
    onChange({ ...filters, dateRange });
  }

  function clearAll() {
    onChange({});
  }

  const activeCount =
    (filters.entityTypes?.length ?? 0) +
    (filters.connectorIds?.length ?? 0) +
    (filters.dateRange?.from || filters.dateRange?.to ? 1 : 0);

  return (
    <aside className="w-56 shrink-0 space-y-0">
      <div className="flex items-center justify-between py-2">
        <h3 className="text-sm font-semibold text-gray-800">Filters</h3>
        {activeCount > 0 && (
          <button
            type="button"
            className="text-xs text-indigo-600 hover:underline"
            onClick={clearAll}
          >
            Clear all ({activeCount})
          </button>
        )}
      </div>

      <CheckboxGroup
        label="Entity Type"
        options={entityTypeOptions}
        selected={filters.entityTypes ?? []}
        onToggle={toggleEntityType}
      />

      <CheckboxGroup
        label="Source Connector"
        options={connectorOptions}
        selected={filters.connectorIds ?? []}
        onToggle={toggleConnector}
      />

      <DateRangePicker
        from={filters.dateRange?.from}
        to={filters.dateRange?.to}
        onChange={handleDateChange}
      />
    </aside>
  );
}
