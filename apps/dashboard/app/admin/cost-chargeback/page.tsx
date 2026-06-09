'use client';

import { useState, useEffect } from 'react';

type EntityCost = { entityId: string; totalTokens: number; estimatedCostUsd: number; queryCount: number };
type ConnectorCost = { connectorId: string; apiCallCount: number; tokensIndexed: number; tokensRetrieved: number; estimatedCostUsd: number };
type UserCost = { userId: string; queryCount: number; totalTokens: number; estimatedCostUsd: number; byConnector: { connectorId: string; tokens: number; costUsd: number }[] };

type Period = 'day' | 'week' | 'month';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

export default function CostChargebackPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [topEntities, setTopEntities] = useState<EntityCost[]>([]);
  const [connectors, setConnectors] = useState<ConnectorCost[]>([]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Cost Chargeback</h1>
          <p className="text-sm text-gray-400 mt-1">Token consumption and compute costs by entity, connector, and user.</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="day">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Cost Attribution Guide</h2>
          <div className="space-y-3 text-sm text-gray-400">
            <p>Use the REST API to query cost breakdowns:</p>
            <div className="bg-gray-800 rounded p-3 font-mono text-xs space-y-1">
              <div className="text-blue-300">GET /api/v1/cost-attribution/entities/:id</div>
              <div className="text-blue-300">GET /api/v1/cost-attribution/connectors/:id?period=month</div>
              <div className="text-blue-300">GET /api/v1/cost-attribution/users/:id?period=week</div>
              <div className="text-blue-300">GET /api/v1/cost-attribution/entities/:id/forecast?interval=month</div>
            </div>
            <p className="text-xs">Costs are estimated at $0.02 per 1M tokens (text-embedding-3-small).</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Pricing Reference</h2>
          <div className="space-y-2">
            {[
              { label: 'text-embedding-3-small', rate: '$0.02/1M tokens', used: true },
              { label: 'text-embedding-3-large', rate: '$0.13/1M tokens', used: false },
              { label: 'API Calls (connectors)', rate: 'Varies by connector', used: true },
              { label: 'Query compute', rate: 'Tracked in compute_ms', used: true },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${r.used ? 'bg-green-400' : 'bg-gray-600'}`} />
                  <span className="text-gray-300">{r.label}</span>
                </div>
                <span className="text-gray-400 text-xs">{r.rate}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">Green = active in Iris. See embedding-patterns.md for model selection rules.</p>
        </div>

        <div className="lg:col-span-2 bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Cost Recording</h2>
          <p className="text-sm text-gray-400 mb-3">
            Record entity-level costs via POST when processing MCP queries:
          </p>
          <pre className="bg-gray-800 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto">
{`POST /api/v1/cost-attribution/attribute
{
  "queryId": "mcp-query-uuid",
  "entityId": "hubspot:contact:123",
  "tokensUsed": 350,
  "computeMs": 45
}`}
          </pre>
          <p className="text-sm text-gray-400 mt-3 mb-3">Record connector sync events:</p>
          <pre className="bg-gray-800 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto">
{`POST /api/v1/cost-attribution/connector-events
{
  "connectorId": "hubspot",
  "apiCallCount": 45,
  "tokensIndexed": 120000,
  "tokensRetrieved": 18000
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
