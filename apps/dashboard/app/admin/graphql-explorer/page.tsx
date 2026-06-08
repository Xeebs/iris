'use client';

import { useState, useEffect } from 'react';
import { GraphQLQueryBuilder } from '../../../components/graphql-query-builder.js';

const DEFAULT_WORKSPACE = 'default';

type AuditEntry = {
  id: number;
  operation_name: string | null;
  query_hash: string;
  query_cost_tokens: number;
  execution_time_ms: number;
  accessed_at: string;
};

export default function GraphQLExplorerPage() {
  const workspaceId = DEFAULT_WORKSPACE;
  const [activeTab, setActiveTab] = useState<'explorer' | 'audit' | 'schema'>('explorer');
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [schemaSDL, setSchemaSDL] = useState('');
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);

  async function loadAuditLog() {
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/v1/graphql/audit?workspaceId=${workspaceId}&limit=50`);
      if (res.ok) {
        const json = await res.json() as { data: AuditEntry[] };
        setAuditLog(json.data);
      }
    } finally {
      setLoadingAudit(false);
    }
  }

  async function loadSchema() {
    setLoadingSchema(true);
    try {
      const res = await fetch('/api/v1/graphql/schema');
      if (res.ok) setSchemaSDL(await res.text());
    } finally {
      setLoadingSchema(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'audit') void loadAuditLog();
    if (activeTab === 'schema') void loadSchema();
  }, [activeTab]);

  const TABS = [
    { id: 'explorer' as const, label: 'Query Explorer' },
    { id: 'audit' as const, label: 'Audit Log' },
    { id: 'schema' as const, label: 'Schema SDL' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-4 h-screen flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">GraphQL Explorer</h1>
        <p className="text-sm text-gray-500 mt-1">
          Interactive GraphQL IDE for the Iris data layer. Queries enforce workspace isolation and token budgets.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'explorer' && (
        <div className="flex-1 min-h-0">
          <GraphQLQueryBuilder workspaceId={workspaceId} />
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Last 50 GraphQL operations for this workspace</p>
            <button onClick={loadAuditLog} className="text-sm text-blue-600 hover:text-blue-800">Refresh</button>
          </div>
          {loadingAudit ? (
            <div className="h-48 animate-pulse bg-gray-100 rounded-lg" />
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['Operation', 'Query Hash', 'Tokens', 'Latency (ms)', 'Time'].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {auditLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{entry.operation_name ?? '(anonymous)'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{entry.query_hash}</td>
                      <td className="px-4 py-2">{entry.query_cost_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2">{entry.execution_time_ms}</td>
                      <td className="px-4 py-2 text-gray-500">{new Date(entry.accessed_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {auditLog.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                        No GraphQL operations recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'schema' && (
        <div>
          {loadingSchema ? (
            <div className="h-48 animate-pulse bg-gray-100 rounded-lg" />
          ) : (
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-6 overflow-auto max-h-[600px] font-mono">
              {schemaSDL || 'Loading schema...'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
