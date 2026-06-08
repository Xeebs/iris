'use client';

import { useState } from 'react';

type AutoTool = {
  toolId: string;
  workspaceId: string;
  sourceConnectorId: string;
  entityType: string;
  version: number;
  generatedAt: string;
  lastInvokedAt: string | null;
};

type AutoToolRegistryProps = {
  workspaceId: string;
  initialTools?: AutoTool[];
};

type ToolType = 'query' | 'list-metrics';

function getToolType(toolId: string): ToolType {
  return toolId.startsWith('list-') ? 'list-metrics' : 'query';
}

function ToolTypeBadge({ toolId }: { toolId: string }) {
  const type = getToolType(toolId);
  return type === 'query' ? (
    <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">query</span>
  ) : (
    <span className="text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">metrics</span>
  );
}

function ConnectorBadge({ connectorId }: { connectorId: string }) {
  const colors: Record<string, string> = {
    hubspot: 'bg-orange-100 text-orange-700',
    salesforce: 'bg-blue-100 text-blue-700',
    slack: 'bg-purple-100 text-purple-700',
    notion: 'bg-gray-100 text-gray-700',
  };
  const color = colors[connectorId] ?? 'bg-gray-100 text-gray-600';
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{connectorId}</span>;
}

export function AutoToolRegistry({ workspaceId, initialTools = [] }: AutoToolRegistryProps) {
  const [tools, setTools] = useState<AutoTool[]>(initialTools);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterConnector, setFilterConnector] = useState<string>('all');

  async function fetchTools() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/mcp/auto-tools', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AutoTool[] };
      setTools(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }

  const connectors = ['all', ...new Set(tools.map(t => t.sourceConnectorId))];

  const filtered = tools.filter(t => {
    const matchesSearch = search.length === 0 || t.toolId.includes(search) || t.entityType.includes(search);
    const matchesConnector = filterConnector === 'all' || t.sourceConnectorId === filterConnector;
    return matchesSearch && matchesConnector;
  });

  const stats = {
    total: tools.length,
    queryTools: tools.filter(t => getToolType(t.toolId) === 'query').length,
    invoked: tools.filter(t => t.lastInvokedAt !== null).length,
    connectors: new Set(tools.map(t => t.sourceConnectorId)).size,
  };

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Auto-Generated Tool Registry</h2>
          <p className="text-xs text-gray-500 mt-0.5">MCP tools generated from connector schemas</p>
        </div>
        <button
          onClick={fetchTools}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium disabled:opacity-50 shrink-0"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {tools.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total tools', value: stats.total },
            { label: 'Query tools', value: stats.queryTools },
            { label: 'Ever invoked', value: stats.invoked },
            { label: 'Connectors', value: stats.connectors },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-xl font-bold text-gray-800">{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search tools…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-sm px-3 py-1.5 rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <select
          value={filterConnector}
          onChange={e => setFilterConnector(e.target.value)}
          className="text-sm px-2 py-1.5 rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          {connectors.map(c => (
            <option key={c} value={c}>{c === 'all' ? 'All connectors' : c}</option>
          ))}
        </select>
      </div>

      {/* Tool table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {filtered.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-gray-400">
            {tools.length === 0 ? (
              <>No tools generated yet.{' '}
                <button onClick={fetchTools} className="underline hover:text-gray-600">Load from server</button>
              </>
            ) : 'No tools match current filters.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Tool ID</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Connector</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Version</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Last invoked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(t => (
                <tr key={t.toolId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{t.toolId}</td>
                  <td className="px-4 py-3">
                    <ConnectorBadge connectorId={t.sourceConnectorId} />
                  </td>
                  <td className="px-4 py-3">
                    <ToolTypeBadge toolId={t.toolId} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">v{t.version}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {t.lastInvokedAt
                      ? new Date(t.lastInvokedAt).toLocaleDateString()
                      : <span className="text-gray-300">Never</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="text-xs text-gray-400">
          Showing {filtered.length} of {tools.length} tools
        </div>
      )}
    </div>
  );
}
