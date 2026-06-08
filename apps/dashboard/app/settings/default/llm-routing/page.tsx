'use client';

import { useState } from 'react';
import ProviderCostComparison from '@/components/provider-cost-comparison';

type Provider = 'anthropic' | 'openai' | 'azure' | 'gemini';
type Tab = 'routing' | 'stats' | 'baselines';

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
  azure: 'Azure OpenAI',
  gemini: 'Google Gemini',
};

const MOCK_ESTIMATES = [
  { provider: 'anthropic' as Provider, estimatedInputTokens: 550, estimatedOutputTokens: 130, estimatedCostCents: 0.20, estimatedLatencyMs: 900 },
  { provider: 'openai' as Provider, estimatedInputTokens: 550, estimatedOutputTokens: 130, estimatedCostCents: 0.28, estimatedLatencyMs: 700 },
  { provider: 'azure' as Provider, estimatedInputTokens: 550, estimatedOutputTokens: 130, estimatedCostCents: 0.28, estimatedLatencyMs: 800 },
  { provider: 'gemini' as Provider, estimatedInputTokens: 550, estimatedOutputTokens: 130, estimatedCostCents: 0.06, estimatedLatencyMs: 600 },
];

const MOCK_RANKED = [
  { provider: 'gemini' as Provider, costScore: 1, speedScore: 1, accuracyScore: 0.90, valueScore: 0.95 },
  { provider: 'anthropic' as Provider, costScore: 0.7, speedScore: 0.6, accuracyScore: 0.97, valueScore: 0.83 },
  { provider: 'openai' as Provider, costScore: 0.5, speedScore: 0.8, accuracyScore: 0.95, valueScore: 0.79 },
  { provider: 'azure' as Provider, costScore: 0.5, speedScore: 0.7, accuracyScore: 0.95, valueScore: 0.77 },
];

const MOCK_STATS = {
  totalQueries: 1240,
  totalCostCents: 248.5,
  avgCostCentsPerQuery: 0.20,
  estimatedSavingsVsDefault: 62.1,
  providerDistribution: { anthropic: 120, openai: 80, azure: 40, gemini: 1000 } as Record<Provider, number>,
};

const MOCK_BASELINES = [
  { provider: 'anthropic' as Provider, complexityRange: [1, 10] as [number, number], accuracyScore: 0.96, sampleCount: 320, measuredAt: new Date() },
  { provider: 'openai' as Provider, complexityRange: [1, 10] as [number, number], accuracyScore: 0.93, sampleCount: 210, measuredAt: new Date() },
  { provider: 'azure' as Provider, complexityRange: [1, 10] as [number, number], accuracyScore: 0.93, sampleCount: 90, measuredAt: new Date() },
  { provider: 'gemini' as Provider, complexityRange: [1, 10] as [number, number], accuracyScore: 0.90, sampleCount: 850, measuredAt: new Date() },
];

export default function LLMRoutingPage() {
  const [tab, setTab] = useState<Tab>('routing');
  const [query, setQuery] = useState('');
  const [contextTokens, setContextTokens] = useState(500);
  const [maxBudget, setMaxBudget] = useState('');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">LLM Cost Optimizer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Analyze provider costs and select the optimal LLM for each query type.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(['routing', 'stats', 'baselines'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'routing' ? 'Cost Estimator' : t === 'stats' ? 'Usage Stats' : 'Accuracy Baselines'}
          </button>
        ))}
      </div>

      {tab === 'routing' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Estimate Query Cost</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">Query</label>
                <textarea
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Enter your query to estimate cost..."
                  className="mt-1 h-20 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Context tokens</label>
                  <input
                    type="number"
                    value={contextTokens}
                    onChange={e => setContextTokens(parseInt(e.target.value, 10) || 500)}
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Max budget (cents)</label>
                  <input
                    type="number"
                    value={maxBudget}
                    onChange={e => setMaxBudget(e.target.value)}
                    placeholder="No limit"
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <ProviderCostComparison
            data={{
              allEstimates: MOCK_ESTIMATES,
              ranked: MOCK_RANKED,
              optimal: { provider: 'gemini', rationale: 'Best value score 95% — cheapest with acceptable accuracy' },
            }}
          />
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Total queries', value: MOCK_STATS.totalQueries.toLocaleString() },
              { label: 'Total cost', value: `$${(MOCK_STATS.totalCostCents / 100).toFixed(2)}` },
              { label: 'Avg per query', value: `$${(MOCK_STATS.avgCostCentsPerQuery / 100).toFixed(4)}` },
              { label: 'Saved vs default', value: `$${(MOCK_STATS.estimatedSavingsVsDefault / 100).toFixed(2)}` },
            ].map(stat => (
              <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">Provider Distribution (30d)</h3>
            <div className="space-y-2">
              {(Object.entries(MOCK_STATS.providerDistribution) as [Provider, number][]).map(([p, count]) => {
                const pct = (count / MOCK_STATS.totalQueries) * 100;
                return (
                  <div key={p} className="flex items-center gap-3">
                    <span className="w-36 text-xs text-gray-600">{PROVIDER_LABELS[p]}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs text-gray-500">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'baselines' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Accuracy</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Samples</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_BASELINES.map(b => (
                <tr key={b.provider} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{PROVIDER_LABELS[b.provider]}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${b.accuracyScore * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-600">{(b.accuracyScore * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{b.sampleCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{b.measuredAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
