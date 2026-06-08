'use client';

import { useState } from 'react';

type QueryResult = {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
  extensions?: { tokensBudgetUsed?: number; executionTimeMs?: number };
};

type Props = {
  workspaceId: string;
  defaultQuery?: string;
};

const STARTER_QUERIES = [
  {
    label: 'List Entities',
    query: `query ListEntities {
  entities(filter: { workspaceId: "WORKSPACE_ID", limit: 10 }) {
    entities { id type label }
    totalCount
    truncated
    tokensBudgetUsed
  }
}`,
  },
  {
    label: 'Get Metrics',
    query: `query GetMetrics {
  metrics(workspaceId: "WORKSPACE_ID") {
    name value unit trend
  }
}`,
  },
  {
    label: 'Glossary',
    query: `query GetGlossary {
  glossary(workspaceId: "WORKSPACE_ID") {
    term definition
  }
}`,
  },
  {
    label: 'Create Entity',
    query: `mutation CreateContact {
  createEntity(input: {
    type: "contact"
    label: "New Contact"
    workspaceId: "WORKSPACE_ID"
  }) {
    success entityId message
  }
}`,
  },
];

function formatJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function GraphQLQueryBuilder({ workspaceId, defaultQuery }: Props) {
  const [query, setQuery] = useState(
    defaultQuery ?? STARTER_QUERIES[0]!.query.replace(/WORKSPACE_ID/g, workspaceId),
  );
  const [variables, setVariables] = useState('{}');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'query' | 'variables' | 'docs'>('query');

  async function runQuery() {
    setLoading(true);
    try {
      let vars: Record<string, unknown> = {};
      try { vars = JSON.parse(variables) as Record<string, unknown>; } catch { /* use empty */ }

      const res = await fetch('/api/v1/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': workspaceId,
          'x-user-role': 'admin',
        },
        body: JSON.stringify({ query, variables: vars }),
      });
      const data = await res.json() as QueryResult;
      setResult(data);
    } catch (e) {
      setResult({ errors: [{ message: e instanceof Error ? e.message : 'Network error' }] });
    } finally {
      setLoading(false);
    }
  }

  const hasErrors = (result?.errors?.length ?? 0) > 0;
  const tokens = result?.extensions?.tokensBudgetUsed;
  const latency = result?.extensions?.executionTimeMs;

  return (
    <div className="flex flex-col gap-0 border rounded-lg overflow-hidden bg-white h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex gap-2">
          <select
            className="text-xs border rounded px-2 py-1 text-gray-600 bg-white"
            onChange={e => {
              const tpl = STARTER_QUERIES.find(q => q.label === e.target.value);
              if (tpl) setQuery(tpl.query.replace(/WORKSPACE_ID/g, workspaceId));
            }}
            defaultValue=""
          >
            <option value="" disabled>Load template...</option>
            {STARTER_QUERIES.map(q => <option key={q.label}>{q.label}</option>)}
          </select>
        </div>
        <button
          onClick={runQuery}
          disabled={loading}
          className="px-4 py-1 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? (
            <><span className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" /> Running...</>
          ) : (
            'Run'
          )}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 divide-x">
        {/* Left panel — editor */}
        <div className="flex flex-col w-1/2">
          <div className="flex border-b">
            {(['query', 'variables', 'docs'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium capitalize
                  ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          {activeTab === 'query' && (
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 p-3 font-mono text-sm text-gray-800 bg-gray-50 resize-none focus:outline-none"
              placeholder="Enter GraphQL query..."
              rows={16}
            />
          )}
          {activeTab === 'variables' && (
            <textarea
              value={variables}
              onChange={e => setVariables(e.target.value)}
              className="flex-1 p-3 font-mono text-sm text-gray-800 bg-gray-50 resize-none focus:outline-none"
              placeholder='{ "id": "example" }'
              rows={16}
            />
          )}
          {activeTab === 'docs' && (
            <div className="flex-1 p-4 overflow-y-auto text-xs text-gray-600 space-y-3">
              <div>
                <p className="font-semibold text-gray-800 mb-1">Query Fields</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li><code>entity(id, workspaceId)</code> — fetch single entity by ID</li>
                  <li><code>entities(filter)</code> — search entities with pagination</li>
                  <li><code>metrics(workspaceId, names)</code> — get business metrics</li>
                  <li><code>glossary(workspaceId, term)</code> — business glossary</li>
                  <li><code>lineage(entityId, workspaceId, depth)</code> — data lineage graph</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-gray-800 mb-1">Mutation Fields</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li><code>createEntity(input)</code></li>
                  <li><code>updateEntity(input)</code></li>
                  <li><code>deleteEntity(id, workspaceId)</code></li>
                  <li><code>runQuery(query, workspaceId, contextBudget)</code></li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — results */}
        <div className="flex flex-col w-1/2">
          <div className="flex items-center justify-between px-3 py-1.5 border-b">
            <span className="text-xs font-medium text-gray-600">Response</span>
            {result && (
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {tokens !== undefined && <span>{tokens} tokens</span>}
                {latency !== undefined && <span>{latency}ms</span>}
                <span className={hasErrors ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                  {hasErrors ? 'error' : 'ok'}
                </span>
              </div>
            )}
          </div>
          <pre className="flex-1 p-3 font-mono text-xs text-gray-800 bg-gray-50 overflow-auto">
            {result ? formatJSON(result) : <span className="text-gray-400">Run a query to see results</span>}
          </pre>
        </div>
      </div>
    </div>
  );
}
